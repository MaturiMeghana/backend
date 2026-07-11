require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { parse } = require('csv-parse');
const { OpenAI } = require('openai');

const app = express();
const upload = multer({ dest: 'uploads/' });

// CHANGED: point at Groq instead of OpenAI
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});
if (!process.env.GROQ_API_KEY) {
  console.error("CRITICAL ERROR: GROQ_API_KEY is missing!");
} else {
  console.log("Success: Groq API Key loaded.");
}

const allowedOrigins = [
  'http://localhost:3000',
  'https://groweasy-web-dldm.onrender.com',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

// Helper function to map data via AI
async function mapToCRM(records) {
  const prompt = `
  Take the following records and map them to the fields: 
  created_at, name, email, country_code, mobile, company, city, state, country, lead_owner, status, notes, source, possession_time, description.
  
  IMPORTANT: Even if some fields are missing, map what you can. DO NOT skip any records.
  Return as a JSON object with a "leads" key containing the array of mapped records.
  
  Records to map: ${JSON.stringify(records)}
  `;

  const response = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile", // CHANGED: Groq model instead of gpt-4o
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  console.log("AI Response:", content); // Check this in your terminal!
  return JSON.parse(content);
}
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const results = [];
  
  const parseCSV = () => new Promise((resolve, reject) => {
    fs.createReadStream(req.file.path)
      .pipe(parse({ columns: true, skip_empty_lines: true }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });

  try {
    await parseCSV();
    fs.unlinkSync(req.file.path);

    const batchSize = 10;
    const processedData = [];

    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      try {
        const mappedBatch = await mapToCRM(batch);
        
        const data = mappedBatch.leads || mappedBatch;
        if (Array.isArray(data)) {
            processedData.push(...data);
        }
      } catch (err) {
        console.error("Batch processing error:", err);
      }
    }

    console.log("Final Data sent to Frontend:", processedData);
    res.json({ message: 'Processed successfully', data: processedData });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).send('Error: ' + err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));