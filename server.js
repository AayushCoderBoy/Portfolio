const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const emailVerifier = require('email-verify');
const crypto = require('crypto');

dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
});

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Database connected successfully');
    }
});

// Test email configuration immediately
transporter.verify((error, success) => {
    if (error) {
        console.error('Email configuration error:', error);
    } else {
        console.log('Email server is ready');
        // Send a test email
        transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'Test Email',
            text: 'This is a test email to verify the configuration'
        }).then(() => {
            console.log('Test email sent successfully');
        }).catch((err) => {
            console.error('Test email failed:', err);
        });
    }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Backend is working!' });
});

// Store verification codes temporarily (in production, use Redis or a database)
const verificationCodes = new Map();

// Generate verification code
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Add a new endpoint to send verification code
app.post('/api/verify-email', async (req, res) => {
    const { email } = req.body;

    // Validate Gmail format
    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
    if (!gmailRegex.test(email)) {
        return res.status(400).json({
            message: 'Please use a valid Gmail address'
        });
    }

    try {
        // Generate a verification code
        const verificationCode = generateVerificationCode();
        
        // Store the code with the email (expires in 10 minutes)
        verificationCodes.set(email, {
            code: verificationCode,
            timestamp: Date.now()
        });

        // Send verification email
        const mailOptions = {
            from: `"Portfolio Verification" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Email Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Email Verification</h2>
                    <p>Your verification code is: <strong>${verificationCode}</strong></p>
                    <p>This code will expire in 10 minutes.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        res.json({ message: 'Verification code sent successfully' });
    } catch (error) {
        console.error('Error sending verification code:', error);
        res.status(500).json({
            message: 'Error sending verification code',
            error: error.message
        });
    }
});

// Update the contact form submission endpoint
app.post('/api/contact/submit', async (req, res) => {
    const { name, email, message, verificationCode } = req.body;

    // Check if all fields are present
    if (!name || !email || !message || !verificationCode) {
        return res.status(400).json({
            message: 'All fields are required, including verification code'
        });
    }

    // Verify the code
    const storedVerification = verificationCodes.get(email);
    if (!storedVerification) {
        return res.status(400).json({
            message: 'Please verify your email first'
        });
    }

    // Check if code is expired (10 minutes)
    if (Date.now() - storedVerification.timestamp > 600000) {
        verificationCodes.delete(email);
        return res.status(400).json({
            message: 'Verification code has expired. Please request a new one'
        });
    }

    // Check if code matches
    if (storedVerification.code !== verificationCode) {
        return res.status(400).json({
            message: 'Invalid verification code'
        });
    }

    try {
        // Save to database
        const dbResult = await pool.query(
            'INSERT INTO contacts (name, email, message) VALUES ($1, $2, $3) RETURNING *',
            [name, email, message]
        );

        // Send notification email
        const mailOptions = {
            from: `"Portfolio Contact" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: `New Contact Form Submission from ${name}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>New Contact Form Submission</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email} (Verified)</p>
                    <p><strong>Message:</strong> ${message}</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        // Clean up verification code
        verificationCodes.delete(email);

        res.status(201).json({
            message: 'Message sent successfully!',
            contact: dbResult.rows[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            message: 'Error sending message',
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Environment variables loaded:', {
        dbUser: process.env.DB_USER,
        dbName: process.env.DB_NAME,
        emailUser: process.env.EMAIL_USER
    });
});