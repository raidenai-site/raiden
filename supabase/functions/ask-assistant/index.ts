// supabase/functions/ask-assistant/index.ts
// Edge function for RAG assistant with tool calling using DeepSeek API
// Requires auth - user must be logged in

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// System prompt for the AI Assistant
const ASSISTANT_SYSTEM_PROMPT = `You're the user's AI companion inside an Instagram DM manager app called Raiden.

You have access to the user's DM history via tools. When you see messages, "Me" = the user, other names = people they chat with.

If the user greets you (hi, hey, etc.) - just chat naturally.
If they ask about a person, use get_conversation to fetch their chat history.
If they ask about topics/emotions, use search_messages to find relevant messages.

Be casual and helpful. Keep responses short unless they ask for details.`

// Tool definitions for function calling
const TOOLS = [
    {
        type: "function",
        function: {
            name: "search_messages",
            description: "Search for messages by topic, emotion, or keywords across all chats.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query - topics, emotions, or keywords"
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_conversation",
            description: "Get the full chat history with a specific person.",
            parameters: {
                type: "object",
                properties: {
                    username: {
                        type: "string",
                        description: "The person's username or name"
                    }
                },
                required: ["username"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_chats",
            description: "List all available chat usernames and their message counts.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    }
]

interface RequestBody {
    question: string
    initial_context?: string
    // Tool results from backend (for multi-turn)
    tool_results?: Array<{
        tool_call_id: string
        name: string
        result: string
    }>
    // Previous messages for context
    messages?: Array<{
        role: string
        content?: string
        tool_calls?: unknown[]
    }>
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

        // 2. Parse request
        const body: RequestBody = await req.json()
        const { question, initial_context, tool_results, messages: prevMessages } = body

        if (!question && !tool_results) {
            return new Response(
                JSON.stringify({ error: 'Missing question or tool_results' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. Get API key
        const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
        if (!DEEPSEEK_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'AI service not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. Build messages
        let messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }>

        if (prevMessages && tool_results) {
            // Continue conversation with tool results
            messages = [...prevMessages]
            for (const tr of tool_results) {
                messages.push({
                    role: 'tool',
                    tool_call_id: tr.tool_call_id,
                    content: tr.result
                })
            }
        } else {
            // New conversation
            const userContent = initial_context
                ? `${question}\n\n[Initial context from message DB:]\n${initial_context}`
                : question

            messages = [
                { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
                { role: 'user', content: userContent }
            ]
        }

        // 5. Call DeepSeek with tools
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages,
                tools: TOOLS,
                tool_choice: 'auto',
                temperature: 0.7,
                max_tokens: 1024,
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
        const assistantMessage = data.choices?.[0]?.message

        if (!assistantMessage) {
            return new Response(
                JSON.stringify({ error: 'No response from AI' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 6. Check if tools need to be called
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            // Return tool calls to backend for execution
            return new Response(
                JSON.stringify({
                    needs_tools: true,
                    tool_calls: assistantMessage.tool_calls.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: JSON.parse(tc.function.arguments)
                    })),
                    messages: [...messages, assistantMessage]
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 7. Return final answer
        console.log('✅ Assistant response generated')
        return new Response(
            JSON.stringify({
                needs_tools: false,
                answer: assistantMessage.content
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
