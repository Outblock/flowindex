import { defineEventHandler, handleCors } from 'h3'

export default defineEventHandler((event) => {
  handleCors(event, {
    origin: [
      'https://run.flowindex.io',
      'https://flowindex.io',
      'https://www.flowindex.io',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3001',
    ],
    methods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: '86400',
  })
})
