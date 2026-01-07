// supabase/functions/generate-profile/index.ts
// Edge function for generating user typing profile using DeepSeek API
// Requires auth - user must be logged in

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
    transcript: string
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
        const { transcript } = body

        if (!transcript) {
            return new Response(
                JSON.stringify({ error: 'Missing required field: transcript' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. Get DeepSeek API key
        const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
        if (!DEEPSEEK_API_KEY) {
            console.error('DEEPSEEK_API_KEY not configured')
            return new Response(
                JSON.stringify({ error: 'AI service not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. Build the prompt
        const prompt = `
Your task is to generate a TYPING-MECHANICS JSON ONLY for the user labeled "Me". Do not include details for any other user in the JSON.

### STRICT BOUNDARIES
- **NO PERSONALITY ANALYSIS:** Do not use words like polite, rude, sarcastic, angry, happy, shy, or aggressive.
- **NO PSYCHOLOGY:** Do not infer intent or feelings.
- **ONLY MECHANICS:** Focus exclusively on keystrokes, grammar, formatting, and syntax.

### DATA TO ANALYZE
TRANSCRIPT:
${transcript}

### OUTPUT FORMAT
Return valid JSON only:
{
    "casing_style": "Exact rule (e.g., 'strictly lowercase', 'start case', 'random caps for emphasis')",
    "punctuation_habits": "Exact rule (e.g., 'no periods', 'spaces before question marks', 'multiple exclamations')",
    "grammar_level": "Observation (e.g., 'perfect grammar', 'ignores apostrophes in contractions', 'run-on sentences')",
    "message_structure": "Observation (e.g., 'single long blocks', 'rapid-fire short bursts', 'uses line breaks')",
    "emoji_mechanics": "Rule (e.g., 'replaces words with emojis', 'end of sentence only', 'never uses them')",
    "common_abbreviations": ["list", "specific", "shorthands", "like", "rn", "u", "idk"],
    "syntax_quirks": "Specific patterns (e.g., 'uses ellipses... a lot', 'starts messages with 'so'', 'never says goodbye')"
}
`

        // 5. Call DeepSeek API (with retry for JSON parsing)
        let profileDict = null
        let lastResponse = ''

        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.4,
                    max_tokens: 2048,
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
            lastResponse = data.choices?.[0]?.message?.content || ''

            // Try to parse JSON from response
            profileDict = tryParseJson(lastResponse)
            if (profileDict) break

            console.log(`⚠️ JSON parse failed (attempt ${attempt + 1}), retrying...`)
        }

        if (!profileDict) {
            console.error('Failed to parse JSON after retries:', lastResponse.substring(0, 500))
            return new Response(
                JSON.stringify({ error: 'Failed to generate valid profile' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        console.log('✅ Profile generated successfully')

        return new Response(
            JSON.stringify({ profile: profileDict }),
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

function tryParseJson(text: string): Record<string, unknown> | null {
    // Clean markdown code blocks
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim()
    // Remove trailing commas before closing braces/brackets
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')

    // Try direct parse
    try {
        return JSON.parse(cleaned)
    } catch {
        // Try to extract JSON object from text
        try {
            const match = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/s)
            if (match) {
                return JSON.parse(match[0])
            }
        } catch {
            // Fall through
        }
    }
    return null
}
