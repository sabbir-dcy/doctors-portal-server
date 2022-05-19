// http://localhost:5000/

const express = require('express')
const corsConfig = {
  origin: true,
  credentials: true,
};
app.use(cors(corsConfig));
app.options("*", cors(corsConfig));
require('dotenv').config()
const jwt = require('jsonwebtoken')

var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
const stripe = require('stripe')(process.env.STRIPE_SECRET);



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

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.c4kfn.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
})

const emailSenderOtions = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY
  }
}

const emailClient = nodemailer.createTransport(sgTransport(emailSenderOtions))

function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking
  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `${patientName}, Your appointment for ${treatment} is on ${date} at ${slot} is confirm`,
    text: `Your appointment for ${treatment} is on ${date} at ${slot} is confirm`,
    html: `
      <div>
        <p>Hi, ${patientName}</p>
        <p>Your appointment for ${treatment} is confirmed</p>
        <p>looking forward to seeing you on ${date} at ${slot}</p>
        <h3>our address</h3>
        <p>andor killa bandorbarn</p>
        <p>Bangladesh</p>
        <a href="https://offshore-stockroom.web.app/">visit our website</a>
      </div>
    `
  };

  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    }
    else {
      console.log('Message sent: ', info);
    }
  });
}
//!----------------jwt function
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


//!------------api run function
async function run() {
  try {
    await client.connect()
    console.log('connected to db')

    const servicesCollection = client
      .db('doctors_portal')
      .collection('services')
    const bookingCollection = client.db('doctors_portal').collection('bookings')
    const userCollection = client.db('doctors_portal').collection('users')
    const doctorCollection = client.db('doctors_portal').collection('doctors')
    const paymentCollection = client.db('doctors_portal').collection('payments')

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email
      const requesterAccount = await userCollection.findOne({
        email: requester,
      })
      if (requesterAccount.role === 'admin') {
        next()
      } else {
        res.status(403).send({ message: 'forbidden: not admin' })
      }
    }
    //* rest api

    //!--------------stripe payment
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      })
      res.send({ clientSecret: paymentIntent.client_secret })
    })

    //!-----------get all services public api
    app.get('/services', async (req, res) => {
      const query = req.query
      const result = await servicesCollection.find(query).project({ name: 1 }).toArray()
      res.send(result)
    })

    //!---------------get booking of individuals
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

    //!-----------------get bookings using id (use params)
    app.get('/booking/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const query = { _id: ObjectId(id) }
      const booking = await bookingCollection.findOne(query)
      res.send(booking)
    })

    //!..............update booking with transaction id
    app.patch('/booking/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const filter = { _id: ObjectId(id) }
      const payment = req.body
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
      const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc)
      const result = await paymentCollection.insertOne(payment)
      res.send(updatedDoc)

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

    //!-----------------get all the use in dashboard
    app.get('/users', verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray()
      res.send(users)
    })

    //!----------------check if logged in user is admin
    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email
      const user = await userCollection.findOne({ email: email })
      const isAdmin = user?.role === 'admin'
      res.send(isAdmin)
    })


    //!----------------set admin role 
    app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {

      const filter = { email: email }
      const updateDoc = {
        $set: { role: 'admin' },
      }
      const result = await userCollection.updateOne(filter, updateDoc)
      res.send(result)

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

    //! --------------available services after each booking
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

    //!----------------add booking
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
      console.log(`sending email....`)
      //send grid
      sendAppointmentEmail(booking)
      res.send({ success: true, result })
    })

    //!get all doctors data
    app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray()

      res.send(doctors)
    })

    //!----------------------add a doctor
    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body
      console.log(doctor)
      const result = await doctorCollection.insertOne(doctor)
      res.send(result)
    })

    //!----------------------delet a doctor
    app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email

      const query = { email: email }
      const result = await doctorCollection.deleteOne(query)
      res.send(result)
    })
  } finally {
  }
}
run().catch(console.dir)
