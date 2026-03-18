// utils/sendEmail.js

/* =====================================================
   ✉️ Universal Email Utility - OneStop Hub
   Uses Brevo (Sendinblue) HTTP API to bypass Render SMTP block
===================================================== */
export const sendEmail = async (to, subject, text = "", html = "", attachments = []) => {
  try {
    // Uses your Brevo API key
    const BREVO_API_KEY = process.env.BREVO_API_KEY || "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";
    
    // Note: The sender email MUST be the one you verified in Brevo.
    // I am using the email from your screenshot, but it will fallback to process.env.EMAIL_USER locally
    const senderEmail = process.env.EMAIL_USER || "chaithanya9727@gmail.com"; 

    // ✅ Default HTML Template if none provided
    const defaultHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f9fafc;">
        <h2 style="color: #4F46E5;">OneStop Hub</h2>
        <p style="font-size: 16px; color: #333;">${text.replace(/\n/g, "<br/>")}</p>
        <p style="margin-top: 30px; font-size: 14px; color: #777;">
          — Team OneStop Hub<br/>
          <a href="mailto:${senderEmail}" style="color:#4F46E5;">${senderEmail}</a>
        </p>
      </div>
    `;

    const payload = {
      sender: { name: "OneStop Hub", email: senderEmail },
      to: [{ email: to }],
      subject: subject,
      textContent: text || "No text content provided.",
      htmlContent: html || defaultHtml,
    };

    // Make the HTTP request to Brevo's mail API
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ Brevo API Error:", errorData);
      return { success: false, error: JSON.stringify(errorData) };
    }

    console.log(`✅ Email sent successfully via Brevo to ${to}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Email send exception:", err.message);
    return { success: false, error: err.message };
  }
};
