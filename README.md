# chargEV DB

## Abstract

This repository holds the code and tools for the chargEV "ChargeEvents" Database.
This database has a public (Server-to-Server) API.

## Development

### Setup

Start the MongoDB in Docker:

```bash
npm install
docker-compose start db
export MONGODB_URI=mongodb://$(docker-machine ip default)/chargevdb
```

#### Setup .env

Create a `.env` file for development:

```
API_JWT_SECRET=secret
```

## Start the FE

```bash
npm run tsc ; npm start
```

## Heroku

This App is currently deployed on Heroku:

https://dashboard.heroku.com/apps/chargev-db

### ENV vars

For production set the same env vars listen in the `.env` file using e.g. `heroku config:add`.

### Get the current MongoDB Dump

Get the current connect Link from mLab (see "installed add-ons" in the Overview section).

The current mongoDB User and Pass are stored in the `MONGODB_URI` config var (See "Settings" section), als the full
URI can be used.

```bash
mongoexport --uri "<MongoDB URI from Heroku>" -c chargeevents > chargeevents.jsonl 
```

### Import a MongoDB Dump

```bash
mongoimport --uri $MONGODB_URI --drop -c chargeevents chargeevents.jsonl 
```
