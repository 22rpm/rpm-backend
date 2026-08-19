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
// Device fingerprint for trust decisions.
//
// Deliberately excludes IP: mobile clients change networks constantly
// (wifi -> cellular -> different tower), and including IP would make a
// known device look new on every switch, re-prompting for OTP.
//
// If the client supplies its own stable device id (mobile apps can generate
// a per-install UUID), fold it in alongside the UA-derived attributes — but
// never use it as the SOLE input. A per-install UUID is not a secret: it is sent
// on every login and may be logged, so anyone holding it could otherwise present
// it and be treated as that trusted device, skipping OTP. Mixing it with the
// UA/os/device means a leaked id alone cannot impersonate the trusted device.
function buildDeviceFingerprint(req, clientDeviceId) {
  const uaString = req.headers['user-agent'] || '';
  const ua = UAParser(uaString);
  const os = `${ua.os.name || ''} ${ua.os.version || ''}`.trim();
  const device = `${ua.device.vendor || ''} ${ua.device.model || ''} ${ua.browser.name || ''}`.trim();

  const input = clientDeviceId
    ? JSON.stringify({ clientDeviceId, ua: uaString, os, device })
    : JSON.stringify({ ua: uaString, os, device });

  const fingerprintHash = crypto.createHash('sha256').update(input).digest('hex');

  return {
    fingerprintHash,
    userAgent: uaString,
    os,
    device,
    ip: getClientIp(req),
    source: clientDeviceId ? 'client-id' : 'server-derived',
  };
}
module.exports = { buildFingerprint, buildDeviceFingerprint, getClientIp };
