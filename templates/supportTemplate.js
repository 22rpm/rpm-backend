export const supportEmailTemplate = ({ email, message }) => `
  <div style="font-family: 'Arial'; padding: 20px; background: #f8f9fa;">
    <div style="max-width: 600px; margin: auto; background: #fff; padding: 25px; border-radius: 10px; border: 1px solid #eaeaea;">
      
      <h2 style="color: #2b7cff;">New Support Message</h2>

      <p style="font-size: 15px;">
        <strong>User Email:</strong> ${email}
      </p>

      <div style="background: #f1f1f1; padding: 15px; border-radius: 6px; margin-top: 10px;">
        <p style="font-size: 15px; line-height: 1.6;">${message}</p>
      </div>

      <br/>
      <p style="font-size: 13px; color: #666;">
        This message was sent from your website contact form.
      </p>

    </div>
  </div>
`;
