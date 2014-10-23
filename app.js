#!/usr/bin/env node

"use strict";

var env = require("node-env-file"),
  path = require("path"),
  AWS = require("aws-sdk"),
  sh = require("sh"),
  SpotifyWebApi = require("spotify-web-api-node");

try {
  env(path.join(__dirname, "/.env"));
}
catch(e) {
  console.log("No .env file found, ensure your environment variables are set");
}

var spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

function getRefreshToken() {
  spotifyApi.clientCredentialsGrant()
    .then(function(data) {
      spotifyApi.setAccessToken(data['access_token']);
      console.log('The access token expires in ' + data['expires_in']);
    }, function(err) {
      console.log('Something went wrong!', err);
    });
}

setInterval(getRefreshToken, 3600000);
getRefreshToken();

var AWS = require("aws-sdk");
AWS.config.update({ region: process.env.AWS_REGION });

var sqs = new AWS.SQS();

function readMessage() {
  sqs.receiveMessage({
    "QueueUrl": process.env.SPOTIFY_QUEUE_URL,
    "MaxNumberOfMessages": 1,
    "VisibilityTimeout": 10,
    "WaitTimeSeconds": 20
  }, function (err, data) {

    var sqs_message_body;

    if (data.Messages) {
      data.Messages.forEach(function(message) {
        var messageData = JSON.parse(message.Body);

        console.log("Recieved message:", messageData);

        if (handleMessage(messageData)) {
          sqs.deleteMessage({
            "QueueUrl": process.env.SPOTIFY_QUEUE_URL,
            "ReceiptHandle": message.ReceiptHandle
          }, function(err, data) {
            if (err) {
              console.log(err);
            }
          });
        } else {
          sqs.changeMessageVisibility({
            "QueueUrl": process.env.SPOTIFY_QUEUE_URL,
            "ReceiptHandle": message.ReceiptHandle,
            VisibilityTimeout: 0
          }, function(err, data) {
            if (err) {
              console.log(err);
            }
          });
        }
      });

      readMessage();
    }
  });
}

readMessage();

setInterval(readMessage, 20000);

function handleMessage(messageData) {
  if (messageData.type == "action") {
    if (messageData.action == "play") {
      // Playlist:
      //   spotify:user:oktavilla-music:playlist:6vfwuQUT16cweeCiPSZhfl
      // Track:
      //   spotify:track:1pLFjj67FdEWo8GOv0Txlf

      if (messageData.url) {
        var url = messageData.url,
          urlParts = messageData.url.split(":");

        if (urlParts[1] === "track") {
          sh('osascript -e \'tell app "Spotify" to play track "' + url +'"\'')

          broadcastCurrentTrack();
        } else if (urlParts[3] === "playlist") {
          spotifyApi.getPlaylist(urlParts[2], urlParts[4], { limit: 1 })
            .then(function(data) {
              var trackUri = data.tracks.items[0].track.uri;

              sh('osascript -e \'tell app "Spotify" to play track "' + trackUri +'" in context "' + url +'"\'')

              broadcastCurrentTrack();
            }, function(err) {
              console.log('Something went wrong!', err);
            });
        }
      } else {
        sh('osascript -e \'tell app "Spotify" to play\'')

        broadcastCurrentTrack();
      }

    }

    if (messageData.action == "pause") {
      sh('osascript -e \'tell app "Spotify" to playpause\'')
    }

    if (messageData.action == "next") {
      sh('osascript -e \'tell app "Spotify" to next track\'')
      broadcastCurrentTrack();
    }

    if (messageData.action == "previous") {
      sh('osascript -e \'tell app "Spotify" to previous track\'')
      broadcastCurrentTrack();
    }

    return true;
  }

  return false;
}

function broadcastCurrentTrack() {
  sh("osascript current_song.scpt").result(function(trackInfo){
    sendMessage({ type: "info", name: "currentTrack", body: "Playing " + trackInfo });
  });;
}

function sendMessage(body) {
  var params = {
    MessageBody: JSON.stringify(body),
    QueueUrl: process.env.SPOTIFY_QUEUE_URL
  };

  sqs.sendMessage(params, function(err, data) {
    if (err){
      console.log(err);
    }
  });
};
