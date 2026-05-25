const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');

const app = express();
app.use(bodyParser.json());

// Paste your Google Sheet Deployment ID here (We will get this in Step 2)
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxXpJY_6_qu6WVXcvBzt5WHZb7DoEpc_h8ajvDTiSZ-MfO83sGIAK8hQ6HQiqAyp5z1hg/exec';

app.post('/webhook', (req, res) => {
    try {
        const payload = req.body;
        console.log('--- RECEIVED 17TRACK WEBHOOK EVENT ---');

        // Extract the data cleanly
        const trackingData = {
            timestamp: new Date().toLocaleString(),
            trackingNumber: payload.data?.number || 'N/A',
            carrier: payload.data?.carrier_code || 'N/A',
            status: payload.data?.track_info?.latest_status || 'N/A',
            eventDetails: payload.data?.track_info?.latest_event || 'No details'
        };

        // Forward this cleanly parsed data to our Google Sheet backend helper
        const dataString = JSON.stringify(trackingData);
        
        const reqOpts = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': dataString.length
            }
        };

        const gReq = https.request(GOOGLE_SCRIPT_URL, reqOpts, (gRes) => {
            console.log(`[SUCCESS] Data routed to Google Sheet via backend proxy.`);
        });

        gReq.on('error', (e) => {
            console.error('[ERROR] Failed routing to sheet helper:', e.message);
        });

        gReq.write(dataString);
        gReq.end();

        // Always reply 200 OK to 17TRACK instantly
        res.status(200).json({ status: 'success' });

    } catch (error) {
        console.error('[SYSTEM ERROR]:', error.message);
        res.status(500).json({ status: 'error' });
    }
});

app.listen(3000, () => console.log('Tunnel Receiver listening on port 3000!'));
