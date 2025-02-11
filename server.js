import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3000;

app.use(cors()); // Enable CORS for all routes

app.use(express.json());

app.get('/tides', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Latitude and longitude are required.' });
  }

  const stationsUrl = `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=harcon&lat=${lat}&lon=${lon}`;

  try {
    const response = await fetch(stationsUrl);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching tide data:', error);
    res.status(500).json({ error: 'Failed to fetch tide data.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

