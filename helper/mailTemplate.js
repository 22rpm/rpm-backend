// emailTemplates.js
function getOtpEmailTemplate(otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification - TwentyTwo RPM</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f5f5f5;
            line-height: 1.6;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            background: linear-gradient(135deg, #014e6b 0%, #4092b3 100%);
            padding: 30px 20px;
            text-align: center;
            color: white;
        }
        
        .logo-placeholder {
            width: 80px;
            height: 80px;
            background-color: rgba(255, 255, 255, 0.2);
            border: 2px dashed rgba(255, 255, 255, 0.5);
            border-radius: 12px;
            margin: 0 auto 15px auto;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.8);
        }
        
        .app-name {
            font-size: 28px;
            font-weight: bold;
            margin: 0;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .content {
            padding: 40px 30px;
            text-align: center;
        }
        
        .greeting {
            font-size: 18px;
            color: #333;
            margin-bottom: 20px;
        }
        
        .otp-section {
            background: linear-gradient(135deg, #7ec3df 0%, #7ec3df 100%);
            padding: 30px;
            margin: 30px 0;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(240, 147, 251, 0.3);
        }
        
        .otp-label {
            font-size: 16px;
            color: white;
            margin-bottom: 15px;
            font-weight: 500;
        }
        
        .otp-code {
            font-size: 36px;
            font-weight: bold;
            color: white;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            margin: 0;
            padding: 15px;
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            display: inline-block;
        }
        
        .instructions {
            font-size: 14px;
            color: #666;
            margin: 25px 0;
            line-height: 1.8;
        }
        
        .warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            font-size: 13px;
        }
        
        .footer {
            background-color: #f8f9fa;
            padding: 25px 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
        }
        
        .auto-message {
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 10px;
            font-style: italic;
        }
        
        .company-info {
            font-size: 13px;
            color: #495057;
            margin-top: 15px;
        }
        
        .divider {
            height: 2px;
            background: linear-gradient(90deg, transparent, #ddd, transparent);
            margin: 25px 0;
            border: none;
        }
        
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 10px;
                box-shadow: 0 2px 8px rgba(1, 78, 107, 0.1);
            }
            
            .content {
                padding: 30px 20px;
            }
            
            .otp-code {
                font-size: 32px;
                letter-spacing: 8px;
                padding: 18px 20px;
            }
            
            .app-name {
                font-size: 28px;
            }
            
            .greeting {
                font-size: 18px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header Section -->
        <div class="header">
            <!--  <div class="logo-placeholder">
                LOGO
            </div>  -->
            <h1 class="app-name">TwentyTwo RPM</h1>
        </div>
        
        <!-- Main Content -->
        <div class="content">
            <!-- <div class="greeting">
                Hello!
            </div> -->
            
            <p>We received a request to verify your account. Please use the OTP code below to complete your verification:</p>
            
            <!-- OTP Section -->
            <div class="otp-section">
                <div class="otp-label">Your One-Time Password</div>
                <div class="otp-code">{{OTP_CODE}}</div>
            </div>
            
            <div class="instructions">
                <strong>Instructions:</strong><br>
                • Enter this code in the verification field<br>
                • This code is valid for 5 minutes only<br>
                • For security reasons, do not share this code with anyone
            </div>
            
            <div class="warning">
                <strong>⚠️ Security Notice:</strong> If you didn't request this verification code, please ignore this email and ensure your account is secure.
            </div>
            
            <hr class="divider">
            
            <p style="color: #666; font-size: 14px;">
                Need help? Contact our support team or visit our help center.
            </p>
        </div>
        
        <!-- Footer Section -->
        <div class="footer">
            <div class="auto-message">
                🤖 This is an auto-generated message. Please do not reply to this email.
            </div>
            
            <div class="company-info">
                <strong>TwentyTwo RPM</strong><br>
                Secure Authentication Service
            </div>
        </div>
    </div>
</body>
</html>`.replace("{{OTP_CODE}}", otp);
}

module.exports = { getOtpEmailTemplate };
