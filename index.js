{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "*/30 * * * *"
    }
  ],
  "functions": {
    "api/index.js": { "maxDuration": 60 },
    "api/cron.js":  { "maxDuration": 60 }
  }
}
