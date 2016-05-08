/* jshint curly: true, eqeqeq: true, forin: true, immed: true, indent: 4,
latedef: true, newcap: true, nonew: true, quotmark: double, undef: true,
unused: true, strict: true, trailing: true, node: true */
/*
    Use to export the redis client
 */
"use strict";
var Promise = require("bluebird");
var mongoose = Promise.promisifyAll(require("mongoose"));
var dbName = "wordcraft";
var dbUri = "mongodb://localhost/"  + dbName;

// Make connection to Mongodb
mongoose.connect(dbUri);
mongoose.connection.once("open", function () {
    console.log("Database open successfully for DB:" + dbName);
});

// This is our mongoose model for todos
var PlayerSchema = mongoose.Schema({
    username: {
        type: String,
        unique: true,
        require: true
    },
    password: {
        type: String,
        require: true
    },
    highScore: Number,
    gamesPlayed: Number
});

var GameSchema = mongoose.Schema({
    // The following stuff are updated per session that the player play
    avatar: String,
    name: {
        type: String,
        unique: true,
        require: true
    },
    id: {
        type: String,
        unique: true,
        require: true
    },
    isReady: Boolean,
    hasResult: Boolean,
    score: Number,
    wordList: [ String ]
});

var Player = mongoose.model("Player", PlayerSchema);
var Game = mongoose.model("Game", GameSchema);

module.exports.Player = Player;
module.exports.Game = Game;
