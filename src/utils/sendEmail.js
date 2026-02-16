// utils/sendEmail.js
import nodemailer from "nodemailer";

/* =====================================================
   ✉️ Universal Email Utility - OneStop Hub
   Supports text and HTML emails (Gmail App Password)
===================================================== */
export const sendEmail = async (to, subject, text = "", html = "") => {
  try {
    // ✅ Configure Gmail SMTP Transporter
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // Use STARTTLS
      auth: {
        user: process.env.EMAIL_USER, // your verified Gmail
        pass: process.env.EMAIL_PASS, // Gmail App Password
      },
      connectionTimeout: 20000, // 20 seconds
      greetingTimeout: 20000, 
      socketTimeout: 20000,
    });

    // ✅ Default HTML Template if none provided
    const defaultHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f9fafc;">
        <h2 style="color: #4F46E5;">OneStop Hub</h2>
        <p style="font-size: 16px; color: #333;">${text.replace(/\n/g, "<br/>")}</p>
        <p style="margin-top: 30px; font-size: 14px; color: #777;">
          — Team OneStop Hub<br/>
          <a href="mailto:${process.env.EMAIL_USER}" style="color:#4F46E5;">${process.env.EMAIL_USER}</a>
        </p>
      </div>
    `;

    const mailOptions = {
      from: `"OneStop Hub" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: text || "No text content provided.",
      html: html || defaultHtml,
    };

    // ✅ Send Email
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${to}: ${info.response}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Email send error:", err.message);
    return { success: false, error: err.message };
  }
};
