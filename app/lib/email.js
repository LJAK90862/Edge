// lib/email.js
// Shared email helper using Gmail SMTP via Nodemailer

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,       // hello@edgeenergy.co.uk
    pass: process.env.GMAIL_APP_PASSWORD // Google App Password (not your Gmail password)
  }
});

export async function sendEmail({ to, subject, html, replyTo }) {
  return transporter.sendMail({
    from: `edge energy <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    replyTo: replyTo || process.env.GMAIL_USER
  });
}
