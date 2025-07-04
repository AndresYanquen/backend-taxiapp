import { Router, Request, Response } from 'express';
import Driver from '../models/driver.model';

const router = Router();

router.post('/drivers', async (req: Request, res: Response) => {
  try {
    const { name, location } = req.body;
    const driver = new Driver({
      name,
      location: {
        type: 'Point',
        coordinates: [location.lng, location.lat]
      }
    });
    await driver.save();
    res.status(201).send(driver);
  } catch (error: any) {
    res.status(400).send({ error: error.message });
  }
});

router.get('/drivers/nearby', async (req: Request, res: Response) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).send({ error: 'Latitude and longitude are required.' });
    }

    const maxDistance = 1000; // 5 km

    const drivers = await Driver.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng as string), parseFloat(lat as string)]
          },
          $maxDistance: maxDistance
        }
      },
      isAvailable: true
    });

    res.send(drivers);
  } catch (error: any) {
    console.error('Error finding nearby drivers:', error);
    res.status(500).send({ error: 'An error occurred while finding drivers.' });
  }
});

export default router;