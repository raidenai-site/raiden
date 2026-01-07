// supabase/functions/generate-reply/index.ts
// Edge function for generating AI replies using DeepSeek API
// Requires auth - user must be logged in

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
    chat_id: string
    transcript: string
    profile: Record<string, unknown>
    rules?: string
    writing_examples?: string
    is_starter?: boolean
    relevant_context?: string
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Verify auth token
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Create Supabase client to verify the JWT
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. Parse request body
        const body: RequestBody = await req.json()
        const { chat_id, transcript, profile, rules, writing_examples, is_starter, relevant_context } = body

        if (!chat_id || !transcript || !profile) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: chat_id, transcript, profile' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. Get DeepSeek API key from secrets
        const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
        if (!DEEPSEEK_API_KEY) {
            console.error('DEEPSEEK_API_KEY not configured')
            return new Response(
                JSON.stringify({ error: 'AI service not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. Build the prompt with system message for better persona consistency
        const ragSection = writing_examples
            ? `\nMY PAST MESSAGES (match this vibe/style):\n${writing_examples}\n`
            : ''

        const relevantSection = relevant_context
            ? `\nRELATED PAST CONVERSATIONS (for context only, don't repeat these):\n${relevant_context}\n`
            : ''

        const rulesSection = rules
            ? `\nCUSTOM RULES (follow exactly):\n${rules}`
            : ''

        // System message defines consistent personality
        const systemMessage = `You are impersonating "Me" in an Instagram DM conversation. Your job is to write replies that sound exactly like how I text.

CRITICAL RULES:
- Sound like a real person texting, NOT an AI or assistant
- NEVER repeat what they just said back to them
- If they ask something, ANSWER it directly first
- Match the energy - if they're chill, be chill. if they're hyped, match it
- It's okay to be brief - "bet", "lol nice", "yea fs" are valid replies
- Read the conversation flow - don't say stuff that doesn't fit
- Use NEWLINES to split into multiple messages if natural (each line = separate message)
- Follow the typing style provided below when sending messages`

        const userPrompt = is_starter
            ? `CONVERSATION SO FAR:
${transcript}

MY TYPING STYLE:
${JSON.stringify(profile, null, 2)}
${ragSection}${relevantSection}${rulesSection}

Write a message to continue/restart this conversation. Output ONLY the message, nothing else.`
            : `CONVERSATION:
${transcript}

Reply to their last message. Output ONLY the reply, nothing else.`

        // 5. Call DeepSeek API
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 100,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('DeepSeek API error:', errorText)
            return new Response(
                JSON.stringify({ error: 'AI service error' }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const data = await response.json()
        const reply = data.choices?.[0]?.message?.content?.trim()
            ?.replace(/"/g, '')
            ?.replace(/^Me:\s*/i, '')

        if (!reply) {
            return new Response(
                JSON.stringify({ error: 'No reply generated' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        console.log(`✅ Generated ${is_starter ? 'STARTER' : 'REPLY'} for ${chat_id}: ${reply.substring(0, 50)}...`)

        return new Response(
            JSON.stringify({ reply, chat_id }),
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
