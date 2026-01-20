const crypto = require('crypto');

// Meta Pixel Configuration
const PIXEL_ID = process.env.META_PIXEL_ID || '1361850507693201';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v18.0';

/**
 * Hash data using SHA256 (required by Meta CAPI)
 */
function hashData(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
}

/**
 * Format phone number for Meta (remove non-digits, add country code)
 */
function formatPhone(phone) {
    if (!phone) return null;
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');
    // Add Indonesia country code if not present
    if (!cleaned.startsWith('62')) {
        if (cleaned.startsWith('0')) {
            cleaned = '62' + cleaned.substring(1);
        } else {
            cleaned = '62' + cleaned;
        }
    }
    return cleaned;
}

module.exports = async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!ACCESS_TOKEN) {
        console.error('META_ACCESS_TOKEN not configured');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const { event_name, event_data, user_data, event_id, event_source_url } = req.body;

        if (!event_name) {
            return res.status(400).json({ error: 'event_name is required' });
        }

        // Build user data with hashing
        const hashedUserData = {
            client_ip_address: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
            client_user_agent: req.headers['user-agent'],
        };

        // Hash PII data if provided
        if (user_data?.phone) {
            hashedUserData.ph = hashData(formatPhone(user_data.phone));
        }
        if (user_data?.email) {
            hashedUserData.em = hashData(user_data.email);
        }
        if (user_data?.first_name) {
            hashedUserData.fn = hashData(user_data.first_name);
        }
        if (user_data?.last_name) {
            hashedUserData.ln = hashData(user_data.last_name);
        }
        if (user_data?.city) {
            hashedUserData.ct = hashData(user_data.city);
        }
        if (user_data?.state) {
            hashedUserData.st = hashData(user_data.state);
        }
        if (user_data?.zip) {
            hashedUserData.zp = hashData(user_data.zip);
        }
        if (user_data?.country) {
            hashedUserData.country = hashData(user_data.country);
        }
        // External ID for better matching
        if (user_data?.external_id) {
            hashedUserData.external_id = hashData(user_data.external_id);
        }
        // FBC and FBP cookies (not hashed)
        if (user_data?.fbc) {
            hashedUserData.fbc = user_data.fbc;
        }
        if (user_data?.fbp) {
            hashedUserData.fbp = user_data.fbp;
        }

        // Build event payload
        const eventPayload = {
            event_name,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            event_source_url: event_source_url || req.headers.referer,
            user_data: hashedUserData,
        };

        // Add event_id for deduplication
        if (event_id) {
            eventPayload.event_id = event_id;
        }

        // Add custom data if provided
        if (event_data) {
            eventPayload.custom_data = {
                currency: event_data.currency || 'IDR',
                value: event_data.value || 0,
                content_name: event_data.content_name,
                content_ids: event_data.content_ids,
                content_type: event_data.content_type || 'product',
                contents: event_data.contents,
                order_id: event_data.order_id,
            };
            // Remove undefined values
            Object.keys(eventPayload.custom_data).forEach(key => {
                if (eventPayload.custom_data[key] === undefined) {
                    delete eventPayload.custom_data[key];
                }
            });
        }

        // Send to Meta Conversions API
        const response = await fetch(
            `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    data: [eventPayload],
                }),
            }
        );

        const result = await response.json();

        if (!response.ok) {
            console.error('Meta CAPI Error:', result);
            return res.status(response.status).json({ 
                error: 'Failed to send event to Meta',
                details: result 
            });
        }

        console.log(`Meta CAPI: ${event_name} event sent successfully`, result);

        return res.status(200).json({ 
            success: true, 
            event_name,
            events_received: result.events_received,
            fbtrace_id: result.fbtrace_id
        });

    } catch (error) {
        console.error('Meta CAPI Error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
};
