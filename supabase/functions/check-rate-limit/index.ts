// supabase/functions/check-rate-limit/index.ts
// Edge function for server-side rate limiting
// Requires auth - user must be logged in

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limit configuration by tier
const RATE_LIMITS: Record<string, { window_hours: number; max_requests: number; cooldown_hours: number }> = {
    free: {
        window_hours: 4,
        max_requests: 26,
        cooldown_hours: 2
    },
    paid: {
        window_hours: 6,
        max_requests: 80,
        cooldown_hours: 1
    }
}

interface RequestBody {
    action: 'check' | 'increment' | 'status'
    tier?: string
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Verify auth
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. Parse request
        const body: RequestBody = await req.json()
        const { action, tier = 'free' } = body
        const limits = RATE_LIMITS[tier] || RATE_LIMITS.free
        const userId = user.id

        // 3. Get or create rate limit state from database
        // First, ensure the table exists (or handle gracefully)
        const { data: existingState, error: fetchError } = await supabaseClient
            .from('rate_limit_state')
            .select('*')
            .eq('user_id', userId)
            .single()

        const now = new Date()

        if (action === 'check') {
            if (!existingState) {
                // No state yet, allowed
                return new Response(
                    JSON.stringify({ allowed: true, reset_at: null }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Check cooldown
            if (existingState.cooldown_until) {
                const cooldownEnd = new Date(existingState.cooldown_until)
                if (now < cooldownEnd) {
                    return new Response(
                        JSON.stringify({ allowed: false, reset_at: existingState.cooldown_until }),
                        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }
            }

            // Check window expiry
            const windowStart = new Date(existingState.window_start)
            const windowEnd = new Date(windowStart.getTime() + limits.window_hours * 60 * 60 * 1000)

            if (now >= windowEnd) {
                // Window expired, reset
                await supabaseClient
                    .from('rate_limit_state')
                    .update({ request_count: 0, window_start: now.toISOString(), cooldown_until: null })
                    .eq('user_id', userId)

                return new Response(
                    JSON.stringify({ allowed: true, reset_at: null }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Check if at limit
            if (existingState.request_count >= limits.max_requests) {
                const cooldownEnd = new Date(now.getTime() + limits.cooldown_hours * 60 * 60 * 1000)

                await supabaseClient
                    .from('rate_limit_state')
                    .update({ cooldown_until: cooldownEnd.toISOString() })
                    .eq('user_id', userId)

                return new Response(
                    JSON.stringify({ allowed: false, reset_at: cooldownEnd.toISOString() }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            return new Response(
                JSON.stringify({ allowed: true, reset_at: null }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (action === 'increment') {
            if (!existingState) {
                // Create new state
                await supabaseClient
                    .from('rate_limit_state')
                    .insert({
                        user_id: userId,
                        request_count: 1,
                        window_start: now.toISOString(),
                        cooldown_until: null
                    })

                return new Response(
                    JSON.stringify({ count: 1, max: limits.max_requests }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const newCount = existingState.request_count + 1
            await supabaseClient
                .from('rate_limit_state')
                .update({ request_count: newCount })
                .eq('user_id', userId)

            return new Response(
                JSON.stringify({ count: newCount, max: limits.max_requests }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (action === 'status') {
            if (!existingState) {
                return new Response(
                    JSON.stringify({
                        tier,
                        current_count: 0,
                        max_requests: limits.max_requests,
                        window_hours: limits.window_hours,
                        cooldown_hours: limits.cooldown_hours,
                        window_start: null,
                        cooldown_until: null,
                        is_limited: false
                    }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const isLimited = (
                (existingState.cooldown_until && now < new Date(existingState.cooldown_until)) ||
                existingState.request_count >= limits.max_requests
            )

            return new Response(
                JSON.stringify({
                    tier,
                    current_count: existingState.request_count,
                    max_requests: limits.max_requests,
                    window_hours: limits.window_hours,
                    cooldown_hours: limits.cooldown_hours,
                    window_start: existingState.window_start,
                    cooldown_until: existingState.cooldown_until,
                    is_limited: isLimited
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ error: 'Invalid action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Edge function error:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
