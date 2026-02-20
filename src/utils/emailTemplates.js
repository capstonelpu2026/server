// utils/emailTemplates.js

export const recruiterApprovedTemplate = (name, orgName) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recruiter Account Approved</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f8f9fa;
      padding: 20px;
      color: #333;
    }
    .container {
      background: #fff;
      border-radius: 12px;
      padding: 25px 35px;
      max-width: 600px;
      margin: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    h1 {
      color: #4a3aff;
      margin-bottom: 15px;
    }
    p {
      line-height: 1.6;
      margin: 10px 0;
    }
    .button {
      display: inline-block;
      padding: 10px 18px;
      background-color: #4a3aff;
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: bold;
      margin-top: 20px;
    }
    footer {
      margin-top: 25px;
      font-size: 13px;
      color: #777;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎉 Congratulations ${name}!</h1>
    <p>Your recruiter account for <strong>${orgName}</strong> has been <b>approved</b>.</p>
    <p>You can now access the OneStop Hub Recruiter Dashboard to post opportunities, manage candidates, and collaborate with institutions.</p>
    <a href="${process.env.CLIENT_URL}/login" class="button">Access Recruiter Dashboard</a>
    <footer>
      <p>— The OneStop Hub Admin Team</p>
    </footer>
  </div>
</body>
</html>
`;

export const recruiterRejectedTemplate = (name, orgName) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recruiter Application Rejected</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f8f9fa;
      padding: 20px;
      color: #333;
    }
    .container {
      background: #fff;
      border-radius: 12px;
      padding: 25px 35px;
      max-width: 600px;
      margin: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    h1 {
      color: #d93025;
      margin-bottom: 15px;
    }
    p {
      line-height: 1.6;
      margin: 10px 0;
    }
    footer {
      margin-top: 25px;
      font-size: 13px;
      color: #777;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚠️ Application Update</h1>
    <p>Hello ${name},</p>
    <p>We regret to inform you that your recruiter registration for <strong>${orgName}</strong> has been <b>rejected</b> after review.</p>
    <p>If you believe this was an error or would like to reapply, please contact our support team at <a href="mailto:support@onestophub.com">support@onestophub.com</a>.</p>
    <footer>
      <p>— The OneStop Hub Admin Team</p>
    </footer>
  </div>
</body>
</html>
`;

export const candidateHiredTemplate = (candidateName, jobTitle, companyName) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're Hired!</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f8f9fa;
      padding: 20px;
      color: #333;
    }
    .container {
      background: #fff;
      border-radius: 12px;
      padding: 30px;
      max-width: 600px;
      margin: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      border-top: 5px solid #10b981; /* Success Green */
    }
    h1 {
      color: #10b981;
      margin-bottom: 20px;
      font-size: 28px;
    }
    p {
      line-height: 1.6;
      margin: 15px 0;
      font-size: 16px;
    }
    .highlight {
      font-weight: bold;
      color: #1f2937;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #10b981;
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: bold;
      margin-top: 25px;
      text-align: center;
    }
    footer {
      margin-top: 30px;
      font-size: 13px;
      color: #6b7280;
      border-top: 1px solid #eee;
      padding-top: 15px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎉 Congratulations, You're Hired!</h1>
    <p>Dear <span class="highlight">${candidateName}</span>,</p>
    
    <p>We are thrilled to inform you that you have been selected for the position of <span class="highlight">${jobTitle}</span> at <span class="highlight">${companyName}</span>!</p>
    
    <p>Your skills and experience impressed our team, and we are excited to have you join us. The HR team will reach out to you shortly with the formal offer letter and next steps.</p>
    
    <a href="${process.env.CLIENT_URL || '#'}" class="button">View Application Status</a>
    
    <p>Welcome to the team!</p>

    <footer>
      <p>— ${companyName} Recruitment Team via OneStop Hub</p>
    </footer>
  </div>
</body>
</html>
`;

export const candidateShortlistedTemplate = (candidateName, jobTitle, companyName) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Application Shortlisted</title>
  <style>
    body { font-family: sans-serif; background-color: #f8f9fa; padding: 20px; color: #333; }
    .container { background: #fff; border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.1); border-top: 5px solid #4a3aff; }
    h1 { color: #4a3aff; }
    .highlight { font-weight: bold; }
    footer { margin-top: 30px; font-size: 13px; color: #6b7280; border-top: 1px solid #eee; padding-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📄 Application Shortlisted!</h1>
    <p>Dear <span class="highlight">${candidateName}</span>,</p>
    <p>We are pleased to inform you that your application for <span class="highlight">${jobTitle}</span> at <span class="highlight">${companyName}</span> has been <b>shortlisted</b>.</p>
    <p>Our team will review your profile further and get in touch if they wish to proceed with an interview.</p>
    <footer><p>— ${companyName} Team via OneStop Hub</p></footer>
  </div>
</body>
</html>
`;

export const candidateInterviewTemplate = (candidateName, jobTitle, companyName, details) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interview Invitation</title>
  <style>
    body { font-family: sans-serif; background-color: #f8f9fa; padding: 20px; color: #333; }
    .container { background: #fff; border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.1); border-top: 5px solid #4a3aff; }
    h1 { color: #4a3aff; }
    .details { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
    footer { margin-top: 30px; font-size: 13px; color: #6b7280; border-top: 1px solid #eee; padding-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📅 Interview Invitation</h1>
    <p>Dear <span class="highlight">${candidateName}</span>,</p>
    <p>The recruitment team at <strong>${companyName}</strong> would like to invite you for an interview for the <span class="highlight">${jobTitle}</span> role.</p>
    <div class="details">
      <p><strong>Date:</strong> ${details?.date ? new Date(details.date).toLocaleDateString() : 'To be confirmed'}</p>
      <p><strong>Time:</strong> ${details?.time || 'To be confirmed'}</p>
      <p><strong>Format:</strong> ${details?.location || 'Virtual / Online'}</p>
      ${details?.link ? `<p><strong>Meeting Link:</strong> <a href="${details.link}">${details.link}</a></p>` : ''}
    </div>
    <p>Please log in to your dashboard to confirm or manage this interview.</p>
    <footer><p>— ${companyName} Recruitment Team via OneStop Hub</p></footer>
  </div>
</body>
</html>
`;

export const candidateRejectedTemplate = (candidateName, jobTitle, companyName, feedback) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Application Update</title>
  <style>
    body { font-family: sans-serif; background-color: #f8f9fa; padding: 20px; color: #333; }
    .container { background: #fff; border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.1); border-top: 5px solid #ef4444; }
    .feedback-box { background-color: #fff1f2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 8px; margin: 25px 0; }
    .feedback-title { color: #991b1b; font-weight: 800; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; margin-bottom: 10px; }
    .feedback-content { font-size: 14px; color: #4b5563; line-height: 1.6; white-space: pre-line; }
    .highlight { font-weight: bold; }
    footer { margin-top: 30px; font-size: 13px; color: #6b7280; border-top: 1px solid #eee; padding-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 20px;">Decision Regarding Your Application</h1>
    <p>Dear <span class="highlight">${candidateName}</span>,</p>
    <p>Thank you for your interest in the <span class="highlight">${jobTitle}</span> position at <span class="highlight">${companyName}</span>.</p>
    <p>Our team has carefully reviewed your profile and performance throughout the recruitment process. At this time, we have decided to move forward with other candidates who more closely align with our current requirements.</p>
    
    ${feedback ? `
    <div class="feedback-box">
      <div class="feedback-title">Professional Growth Feedback</div>
      <div class="feedback-content">${feedback}</div>
    </div>
    ` : ''}

    <p style="margin-top: 20px;">We appreciate the time you invested in applying to <span class="highlight">${companyName}</span> and wish you the very best in your job search and professional journey.</p>
    
    <footer><p>— ${companyName} Talent Acquisition via OneStop Hub</p></footer>
  </div>
</body>
</html>
`;

export const candidateOfferedTemplate = (candidateName, jobTitle, companyName, offerDetails) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Job Offer: ${jobTitle}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; padding: 20px; color: #333; }
    .container { background: #fff; border-radius: 12px; padding: 30px; max-width: 600px; margin: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.1); border-top: 5px solid #fbbf24; }
    h1 { color: #d97706; font-size: 24px; }
    .details { background: #fffbeb; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #fef3c7; }
    .details p { margin: 8px 0; font-size: 15px; }
    .highlight { font-weight: bold; color: #1f2937; }
    .btn { display: inline-block; padding: 12px 24px; background-color: #d97706; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 15px; }
    footer { margin-top: 30px; font-size: 13px; color: #6b7280; border-top: 1px solid #eee; padding-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>💼 Official Job Offer</h1>
    <p>Dear <span class="highlight">${candidateName}</span>,</p>
    <p>We are delighted to extend an official job offer for the position of <span class="highlight">${jobTitle}</span> at <span class="highlight">${companyName}</span>!</p>
    
    <div class="details">
      <p><strong>Annual Package (CTC):</strong> ${offerDetails.salary}</p>
      <p><strong>Joining Date:</strong> ${offerDetails.joinDate ? new Date(offerDetails.joinDate).toLocaleDateString() : 'To be confirmed'}</p>
      <p><strong>Department:</strong> ${offerDetails.department || 'TBD'}</p>
      <p><strong>Job Mode:</strong> ${offerDetails.workMode || 'On-site'}</p>
    </div>

    <p>Please log in to the OneStop Hub dashboard to review and respond to this offer. We look forward to having you join our team!</p>
    
    <a href="${process.env.CLIENT_URL || '#'}/dashboard" class="btn">View & Respond to Offer</a>

    <footer><p>— ${companyName} Talent Acquisition via OneStop Hub</p></footer>
  </div>
</body>
</html>
`;
