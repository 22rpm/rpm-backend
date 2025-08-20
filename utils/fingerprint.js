const crypto = require('crypto');
const UAParser = require('ua-parser-js');

function getClientIp(req) {
  // If you’re behind a proxy/load balancer:
  // app.set('trust proxy', true) in server.js
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function buildFingerprint(req) {
  const ip = getClientIp(req);
  const uaString = req.headers['user-agent'] || '';
  const ua = UAParser(uaString);

  const os = `${ua.os.name || ''} ${ua.os.version || ''}`.trim();
  const device = `${ua.device.vendor || ''} ${ua.device.model || ''} ${ua.browser.name || ''}`.trim();

  // Stable input for hash
  const input = JSON.stringify({
    ip, 
    ua: uaString,
    os,
    device,
  });

  const fingerprintHash = crypto.createHash('sha256').update(input).digest('hex');
  return { ip, userAgent: uaString, os, device, fingerprintHash };
}

module.exports = { buildFingerprint, getClientIp };
