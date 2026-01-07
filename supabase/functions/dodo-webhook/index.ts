// supabase/functions/dodo-webhook/index.ts
// Webhook handler for DodoPayments subscription events

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const webhookSecret = Deno.env.get('DODO_WEBHOOK_SECRET')
        if (!webhookSecret) {
            console.error('DODO_WEBHOOK_SECRET not configured')
            return new Response(
                JSON.stringify({ error: 'Webhook secret not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get the raw body and headers for verification
        const body = await req.text()
        const webhookId = req.headers.get('webhook-id') || ''
        const webhookTimestamp = req.headers.get('webhook-timestamp') || ''
        const webhookSignature = req.headers.get('webhook-signature') || ''

        // Verify webhook signature using Standard Webhooks
        const wh = new Webhook(webhookSecret)
        let payload: any

        try {
            payload = wh.verify(body, {
                'webhook-id': webhookId,
                'webhook-timestamp': webhookTimestamp,
                'webhook-signature': webhookSignature,
            })
        } catch (err) {
            console.error('Webhook verification failed:', err)
            return new Response(
                JSON.stringify({ error: 'Invalid webhook signature' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        console.log('📨 Received webhook event:', payload.type)

        // Create Supabase client with service role key
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const eventType = payload.type
        const data = payload.data

        // Handle subscription events
        switch (eventType) {
            case 'subscription.active': {
                // User subscribed successfully
                const dodoCustomerId = data.customer?.customer_id || data.customer_id
                const subscriptionId = data.subscription_id
                const currentPeriodEnd = data.current_period_end

                // CRITICAL: Get Supabase user ID from metadata
                // We passed this during checkout session creation
                const userId = data.metadata?.user_id

                console.log(`✅ Subscription activated. Dodo Customer: ${dodoCustomerId}, User ID: ${userId}`)

                if (!userId) {
                    console.error('❌ No user_id in metadata! Cannot link subscription to user.')
                    // Fallback? If we can't link, we can't give access.
                    break
                }

                // Update users table
                const { error } = await supabaseClient
                    .from('users')
                    .upsert({
                        id: userId,
                        tier: 'paid',
                        // subscription_id: subscriptionId, // assuming these columns are added too?
                        customer_id: dodoCustomerId,
                        // expires_at: currentPeriodEnd ? new Date(currentPeriodEnd).toISOString() : null,
                        // updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'id'
                    })

                if (error) {
                    console.error('Failed to update user membership:', error)
                } else {
                    console.log(`🎉 User ${userId} upgraded to paid tier`)
                }
                break
            }

            case 'subscription.cancelled': {
                // User cancelled subscription
                const dodoCustomerId = data.customer?.customer_id || data.customer_id
                console.log(`❌ Subscription cancelled for Dodo Customer: ${dodoCustomerId}`)

                if (!dodoCustomerId) break

                // We have to find the user by customer_id since metadata might not be in cancellation event
                // Or we can query by subscription_id if available.
                // Assuming we stored customer_id in subscription.active

                // Set tier back to free
                const { error } = await supabaseClient
                    .from('user_memberships')
                    .update({
                        tier: 'free',
                        subscription_id: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('customer_id', dodoCustomerId) // Use customer_id to find record

                if (error) {
                    console.error('Failed to update membership:', error)
                } else {
                    console.log(`📉 User with customer_id ${dodoCustomerId} downgraded to free tier`)
                }
                break
            }

            case 'subscription.updated': {
                // Subscription renewed or updated
                const dodoCustomerId = data.customer?.customer_id || data.customer_id
                const currentPeriodEnd = data.current_period_end
                console.log(`🔄 Subscription updated for Dodo Customer: ${dodoCustomerId}`)

                if (!dodoCustomerId) break

                // Update expiry date
                const { error } = await supabaseClient
                    .from('user_memberships')
                    .update({
                        expires_at: currentPeriodEnd ? new Date(currentPeriodEnd).toISOString() : null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('customer_id', dodoCustomerId)

                if (error) {
                    console.error('Failed to update membership expiry:', error)
                } else {
                    console.log(`📅 Updated expiry for user with customer_id ${dodoCustomerId}`)
                }
                break
            }

            case 'payment.succeeded': {
                console.log(`💰 Payment succeeded for customer: ${data.customer?.customer_id || data.customer_id}`)
                // Optional: Log successful payments for analytics
                break
            }

            default:
                console.log(`ℹ️ Unhandled event type: ${eventType}`)
        }

        return new Response(
            JSON.stringify({ received: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Webhook handler error:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
