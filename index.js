// http://localhost:5000/

const express = require('express')
const cors = require('cors')
require('dotenv').config()
const jwt = require('jsonwebtoken')

const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Doctors app listening on port ${port}`)
})

const { MongoClient, ServerApiVersion } = require('mongodb')
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.c4kfn.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
})

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  const token = authHeader.split(' ')[1]
  jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
    if (error) {
      return res.status(403).send({ message: 'forbidden access' })
    }
    req.decoded = decoded
    next()
  })
}
async function run() {
  try {
    await client.connect()
    console.log('connected to db')

    const servicesCollection = client
      .db('doctors_portal')
      .collection('services')
    const bookingCollection = client.db('doctors_portal').collection('bookings')
    const userCollection = client.db('doctors_portal').collection('users')

    // rest api
    app.get('/services', async (req, res) => {
      const query = req.query
      const result = await servicesCollection.find(query).project({ name: 1 }).toArray()
      res.send(result)
    })

    app.get('/booking', verifyJWT, async (req, res) => {
      const patient = req.query.patient
      const decodedEmail = req.decoded.email
      if (patient === decodedEmail) {
        const query = { patient: patient }
        const bookings = await bookingCollection.find(query).toArray()
        return res.send(bookings)
      } else {
        return res.status(403).send({ message: 'forbidden access unkown' })
      }
    })

    /**
     * ?api maming convention
     * ?app.get('/booking') -> get all booking
     * ?app.get('/booking/:id') -> get specific booking
     * ?app.post('/booking') -> add a new booking
     * ?app.patch('/booking/:id')
     * ?app.delete('/booking/:id')
     * ?app.put('/booking:id',) -> upsert : if exist update or create
     */

    app.get('/users', verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray()
      res.send(users)
    })

    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email
      const user = await userCollection.findOne({ email: email })
      const isAdmin = user.role === 'admin'
      res.send(isAdmin)
    })

    app.put('/user/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email

      const requester = req.decoded.email
      const requesterAccount = await userCollection.findOne({
        email: requester,
      })
      if (requesterAccount.role === 'admin') {
        const filter = { email: email }
        const updateDoc = {
          $set: { role: 'admin' },
        }
        const result = await userCollection.updateOne(filter, updateDoc)
        res.send(result)
      } else {
        res.status(403).send({ message: 'forbidden: not admin' })
      }
    })
    app.put('/user/:email', async (req, res) => {
      const email = req.params.email
      const filter = { email: email }
      const user = req.body
      const option = { upsert: true }

      const updateDoc = {
        $set: user,
      }

      const result = await userCollection.updateOne(filter, updateDoc, option)

      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, {
        expiresIn: '1h',
      })
      res.send({ result, token })
    })

    app.get('/available', async (req, res) => {
      const date = req.query.date

      //?step 1: get all services
      const services = await servicesCollection.find().toArray()

      //?step 2: get the booking of that date, o/p: [{},{},{}]
      const query = { date: date }
      const bookings = await bookingCollection.find(query).toArray()

      //! this is not the proper way to query
      //! in future use aggregate lookup,pipeline, match, group
      //?step3: for each service
      services.forEach((service) => {
        //?step4: find bookings for that service, o/p: [{},{},{}]
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        )
        //?step5: select slots for the service Bookings: o/p: ['','','']
        const bookedSlots = serviceBookings.map((booking) => booking.slot)
        //?step6: select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        )
        //?step7: set available slots to make it easier
        service.slots = available
      })
      res.send(services)
    })

    app.post('/booking', async (req, res) => {
      const booking = req.body
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      }
      const exist = await bookingCollection.findOne(query)
      if (exist) {
        return res.send({ success: false, booking: exist })
      }
      const result = await bookingCollection.insertOne(booking)
      res.send({ success: true, result })
    })
  } finally {
  }
}
run().catch(console.dir)
