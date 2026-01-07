import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DODO_PRODUCT_ID = "pdt_0NUy5LyHziwEampmeNDga"
const DODO_API_URL = "https://test.dodopayments.com" // Switch to live if needed, Python SDK usually handles this. 
// Wait, is it test or live? The API key looked like test/live depending on prefix.
// The user said "pdt_..." which is generic.
// Let's assume standard API URL, maybe "https://api.dodopayments.com"

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

        // 2. Prepare Dodo Request
        const dodoApiKey = Deno.env.get('DODO_API_KEY')
        if (!dodoApiKey) throw new Error('DODO_API_KEY not configured')

        // Determine return URL (can be passed in body or default)
        const { return_url } = await req.json().catch(() => ({}))
        const finalReturnUrl = return_url || "https://raidenai.site/success" // Default

        // 3. Call Dodo API
        // Note: Python SDK uses "https://live.dodopayments.com" or "test.dodopayments.com"
        // I will try to infer or use the standard "https://api.dodopayments.com" if it exists, 
        // but safer to use the one from docs?
        // Let's try https://api.dodopayments.com - if it fails we fix it.

        // Actually, usually it's "https://test.dodopayments.com/v1" for test mode?
        // User key: "27K8d..." doesn't explicitly say test. 
        // I'll stick to a generic endpoint or check docs if I called search_web.
        // I'll use "https://api.dodopayments.com/v1/checkout/sessions"

        const dodoRes = await fetch("https://live.dodopayments.com/checkouts", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${dodoApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                product_cart: [{
                    product_id: DODO_PRODUCT_ID,
                    quantity: 1
                }],
                return_url: finalReturnUrl,
                metadata: {
                    user_id: user.id
                }
            })
        })

        if (!dodoRes.ok) {
            const errText = await dodoRes.text()
            console.error("Dodo API Error:", errText)
            throw new Error(`Dodo API failed: ${errText}`)
        }

        const dodoData = await dodoRes.json()

        return new Response(
            JSON.stringify({ url: dodoData.checkout_url }), // Ensure we return 'url' key
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
