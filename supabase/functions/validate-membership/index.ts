// supabase/functions/validate-membership/index.ts
// Edge function for validating user membership tier
// Requires auth - user must be logged in

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limit configuration by tier
const TIER_LIMITS: Record<string, { window_hours: number; max_requests: number; cooldown_hours: number }> = {
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

        // 2. Get user's membership from database
        const { data: membership, error: membershipError } = await supabaseClient
            .from('users')
            .select('tier')
            .eq('id', user.id)
            .single()

        let tier = 'free'
        let expiresAt = null

        if (membership && !membershipError) {
            // Check if membership is still valid
            if (membership.expires_at) {
                const expiry = new Date(membership.expires_at)
                if (expiry > new Date()) {
                    tier = membership.tier || 'free'
                    expiresAt = membership.expires_at
                }
            } else {
                // No expiry = lifetime membership
                tier = membership.tier || 'free'
            }
        }

        const limits = TIER_LIMITS[tier] || TIER_LIMITS.free

        return new Response(
            JSON.stringify({
                user_id: user.id,
                tier,
                expires_at: expiresAt,
                limits: {
                    window_hours: limits.window_hours,
                    max_requests: limits.max_requests,
                    cooldown_hours: limits.cooldown_hours
                }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Edge function error:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
