import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Authenticate User
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            throw new Error('No authorization header')
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

        if (userError || !user) {
            throw new Error('Invalid user token')
        }

        // 2. Get customer_id from users table
        const { data: userData, error: dbError } = await supabaseClient
            .from('users')
            .select('customer_id')
            .eq('id', user.id)
            .single()

        if (dbError || !userData?.customer_id) {
            throw new Error('No subscription found. Please upgrade first.')
        }

        const customerId = userData.customer_id

        // 3. Call Dodo API to create portal session
        const dodoApiKey = Deno.env.get('DODO_API_KEY')
        if (!dodoApiKey) throw new Error('DODO_API_KEY not configured')

        const dodoRes = await fetch(`https://live.dodopayments.com/customers/${customerId}/customer-portal/session`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${dodoApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({})
        })

        if (!dodoRes.ok) {
            const errText = await dodoRes.text()
            console.error("Dodo Portal API Error:", errText)
            throw new Error(`Portal creation failed: ${errText}`)
        }

        const dodoData = await dodoRes.json()

        return new Response(
            JSON.stringify({ url: dodoData.link }), // Dodo portal returns 'link'
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Error:', error.message)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
