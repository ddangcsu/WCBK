/* jshint curly: true, eqeqeq: true, forin: true, immed: true,
 indent: 4, latedef: true, newcap: true, nonew: true, quotmark: double,
 undef: true, unused: true, strict: true, trailing: true, node: true */
 "use strict";
// Create an instance of Socket IO server
var Promise = require("bluebird");
var io = require("socket.io")();
var _ = require("lodash");

var mClient;
var rClient;

var gameInProgress = "wc:inProgress";
var gameReadyCheck = "wc:readyCheck";
var gameSentResult = "wc.sentResult";

// Private function to emit an ioEvent with a count down seconds
var sendTimer = function (ioEvent, seconds) {
    // Return a promise to do things when the countdown completed
    return new Promise(function (resolve) {
        var timer = seconds;
        var countdown = setInterval(function () {
            // the ioEvent i.e. countdown
            io.emit(ioEvent, {"timer": timer});
            console.log(ioEvent + " : " + timer);
            timer--;
            if (timer === -1) {
                clearInterval(countdown);
                resolve(true);
            }
        }, 1000);
    });
};

// Private function to send up the letters
var sendLetters = function (ioEvent) {
    //TODO: as for now, randomly output 10 letters
    var vowels = "AEIOU";
    var consonants = "BCDFGHJKLMNPQRSTVWXYZ";

    var random = _.sampleSize(vowels,2).join("") + _.sampleSize(consonants,6).join("");
    var letters = _.shuffle(random.split(""));

    // Return a promise to do things when send Letters completed
    return new Promise(function (resolve) {
        io.emit(ioEvent, {"letters":letters});
        resolve(letters);
    });
};

// Private function to start the game
var startGame = function (countDownTime, gameAllotTime) {

    // First change the game state from readyCheck to inProgress
    rClient.renameAsync(gameReadyCheck, gameInProgress)
    .then(function (result) {
        // Then if the game state change appropriate start the count down
        if (result) {
            console.log("Game Ready State Changed to inProgress: " + result);
            console.log("Start count down ...");
            var ioEvent = "countdown";
            return sendTimer(ioEvent, countDownTime);
        } else {
            return Promise.reject(new Error("Unable to change game state"));
        }
    })
    .then(function () {
        // Then we send up the letters to the client
        console.log("Send up the letters");
        var ioEvent = "game letters";
        return sendLetters(ioEvent);
    })
    .then(function (letters) {
        // Then we send up the game timer
        console.log("Letters sent to players");
        console.log(letters);
        var ioEvent = "game timer";
        return sendTimer(ioEvent, gameAllotTime);
    })
    .then(function () {
        // When the timer ended, we send up a time up event to player
        io.emit("game timeup");
        console.log("Game finished");
    })
    .catch(function (err) {
        console.log("Start Game Chain error", err);
    });

};

// Private function to handle the game state when a player disconnected
var handleGameStart = function () {

    // We only need to check if the game is in readyCheck state.
    rClient.existsAsync(gameReadyCheck)
    .then(function (exist) {
        // If exist, we will get our player list
        if (exist) {
            console.log("Game is in Ready Check state", exist);
            return mClient.Game.find().select("name id isReady -_id").execAsync();
        } else {
            return Promise.resolve(false);
        }
    })
    .then(function (playerList) {
        // Then we check the playerList to compare the number of players
        // and the number of isReady.  If both match we start the game
        if (playerList) {
            console.log("playerList is: " + playerList);
            var userCount = _.size(playerList);
            var readyCount = _.filter(playerList, {"isReady": true}).length;

            console.log("Total players: " + userCount);
            console.log("Total ready: " + readyCount);

            // Call GameStart();
            if (userCount === readyCount) {
                var countDownTime = 5;
                var gameTimer = 20;
                startGame(countDownTime, gameTimer);
            }
        }
        // If nothing to do, we skip
    })
    .catch(function (err) {
        console.log("Error handleGameStart: ", err);
    });

};

// Private function to send up the result
var sendResult = function (ioEvent, payload) {
    // We add a game status
    rClient.renameAsync(gameInProgress, gameSentResult)
    .then(function (renamed) {
        if (renamed) {
            console.log("Game Ready State Changed to sentResult: " + renamed);
            io.emit(ioEvent, payload);
            return Promise.resolve(true);
        } else {
            return Promise.resolve(false);
        }
    })
    .then(function (status) {
        // If we need to reset game state and reset players
        if (status) {
            // We clear a set of storage to set the game state
            var clearInProgress = rClient.delAsync(gameInProgress);
            var clearReadyCheck = rClient.delAsync(gameReadyCheck);
            var clearSentResult = rClient.delAsync(gameSentResult);

            var sqlUpdate = {
                $set: {
                    isReady: false,
                    hasResult: false,
                    wordList: []
                }
            };
            var resetPlayerStats = mClient.Game.updateAsync({}, sqlUpdate, {multi: true});

            Promise.all([clearInProgress, clearReadyCheck, clearSentResult, resetPlayerStats])
            .then(function (result) {
                console.log("Clear Game State after sending game score " + result);
            })
            .catch(function (err) {
                console.log("Error encountered handle result: ", err);
            });
        }
    })
    .catch(function (err) {
        console.log("Error sendResult: ", err);
    });

};

// Private function to handle the game result
var handleGameResult = function () {
    // We only need to check if the game is in Progress state.
    rClient.existsAsync(gameInProgress)
    .then(function (exist) {
        // If exist, we will get our player list
        if (exist) {
            console.log("Game is in Progress state", exist);
            return mClient.Game.find().select("-_id -__v").execAsync();
        } else {
            return Promise.resolve(false);
        }
    })
    .then(function (playerList) {
        // Then we check the playerList to compare the number of players
        // and the number of isReady.  If both match we start the game
        if (playerList) {
            console.log("playerList is: " + playerList);
            var userCount = _.size(playerList);
            var resultCount = _.filter(playerList, {"hasResult": true}).length;

            console.log("Total players: " + userCount);
            console.log("Total results: " + resultCount);

            // Send up the game result
            if (userCount === resultCount) {
                // We map the playerList result to a payload
                // We order the players with the highest score first
                var sortedPlayer = _.orderBy(playerList, "score", "desc");
                // Then we map it to payload so that we only pick out the fields
                // we want
                var payload = _.map(sortedPlayer, function (player) {
                    return {
                        name: player.name,
                        avatar: player.avatar,
                        score: player.score,
                        wordList: player.wordList
                    };
                });

                // Then we send up the payload to client
                var ioEvent = "game result";
                sendResult(ioEvent, payload);
            }
        }
    })
    .catch(function (err) {
        console.log("Error handleGameResult: ", err);
    });
};

// Private function to initialize game state
var initializeGame = function () {
    // We clear a set of storage to set the game state
    var clearInProgress = rClient.delAsync(gameInProgress);
    var clearReadyCheck = rClient.delAsync(gameReadyCheck);
    var clearSentResult = rClient.delAsync(gameSentResult);
    var clearGameTable = mClient.Game.removeAsync({});

    Promise.all([clearInProgress, clearReadyCheck, clearSentResult, clearGameTable])
    .then(function (result) {
        console.log("Initialize to clear the game state " + result);
    })
    .catch(function (err) {
        console.log("Error encountered clear state: ", err);
    });

};

// Main function that will get exports
var initServerIO = function (server, mongo, redis) {
    console.log("Initialize the Socket IO server");

    // Attached socket IO to HTTP server
    io.attach(server);

    // Save a reference of the mongo and redis client
    // Incase we need to save data
    mClient = mongo;
    rClient = redis;

    // Initialize the game state here
    initializeGame();

    // Listen for client connection when a client connect a new socket
    // is created for that client
    io.on("connection", function (socket) {
        // If the game is in progress, disconnect the player.
        rClient.existsAsync(gameInProgress)
        .then(function (exist) {
            // Then if exist, we tell the player that gmae in progress
            // and disconnect him
            if (exist) {
                socket.emit("game in progress");
                socket.disconnect();
            } else {
                console.log("A client has been connected", socket.id);
            }
        })
        .catch(function (err) {
            console.log("Error checking Game Progress Key", err);
        });

        // Handle greeting from client
        // Hello payload contain: type, from, to, msg
        socket.on("hello", function (payload) {
            socket.name = payload.from;
            socket.avatar = payload.avatar;

            console.log(payload.type + ": <" + socket.name + "> says " + payload.msg);

            // Send a greeting back to client
            var newPayload = {};
            newPayload.type = "greeting";
            newPayload.from = "Server";
            newPayload.to = "";
            newPayload.msg = "Hi " + socket.name +", Welcome to WordCraft game";

            socket.emit("hello", newPayload);
            console.log("Greet user: " + socket.name);

            // Save the player into the Games table
            var newPlayer = mClient.Game({
                avatar: socket.avatar,
                name: socket.name,
                id: socket.id,
                isReady: false,
                hasResult: false,
                score: 0,
                wordList: []
            });

            newPlayer.saveAsync()
            .then(function (result) {
                // Then we get a list of players back
                console.log("Add new player to Game table " + result);
                // Query all players in Game for name, id
                return mClient.Game.find().select("avatar name id -_id").execAsync();
            })
            .then(function (playerList) {
                // Then we notify the rest of the players that a new player
                // joined and provide a new full list of players
                console.log("Search result is: ", playerList);
                // Craft a new payload to notify all users that a new player joined
                newPayload = {};
                newPayload.type = "system";
                newPayload.from = "Server";
                newPayload.to = "";
                newPayload.msg = socket.name + " has joined the game";
                io.emit("join game", newPayload);
                console.log(socket.name + " has joined the game");

                // Craft another payload to send just the list of players
                newPayload = {};
                newPayload.players = playerList;
                io.emit("player joined", newPayload);

            })
            .catch(function (err) {
                console.log("Unable to add player", err);
            });

        });

        // Handle chat message from client
        // Payload contains: type, from, to, msg
        socket.on("send message", function (payload) {
            var newPayload = {};
            if (payload.type === "private") {
                // Deal with private message
                var sendTo = payload.to.id;

                // Craft the payload for client
                newPayload.type = payload.type;
                newPayload.from = "Whisper from";
                newPayload.to = payload.from;
                newPayload.msg = payload.msg;

                console.log("Forward private message to " + sendTo);
                console.log("Payload is: " + newPayload);
                // Send the message privately to the sendTo socket ID
                socket.broadcast.to(sendTo).emit("send message", newPayload);

            } else if (payload.type === "public") {
                // Just forward the payload to others
                console.log("Forward public message");
                socket.broadcast.emit("send message", payload);
            }
        });

        // Show when a client disconnected
        socket.on("disconnect", function () {
            if (socket.hasOwnProperty("name")) {
                console.log("A client has disconnected " + socket.id);
                //console.log("Total connected clients: " + _.size(io.sockets.connected));
                var newPayload = {};
                var player = {
                    name: socket.name,
                    id: socket.id
                };

                // Delete player from current game
                mClient.Game.remove({id: socket.id}).execAsync()
                .then(function (result) {
                    console.log("Remove player" + result);

                    // Broadcast event player has left
                    newPayload.type = "system";
                    newPayload.from = "Server";
                    newPayload.to = "";
                    newPayload.msg = socket.name + " left the game";
                    socket.broadcast.emit("leave game", newPayload);

                    // Separate message to tell client to update the list of player
                    newPayload = {};
                    newPayload.players = [player];
                    socket.broadcast.emit("player left", newPayload);

                    // Handle game when a player Disconnect
                    handleGameStart();
                    // Handle game result when a player Disconnect
                    handleGameResult();
                })
                .catch(function (err) {
                    console.log("Unable to remove player", err);
                });

            } else {
                // If a player does not have a name attached to the socket
                // it means the player was never officially join the game
                console.log("Disconnect player who join while game in progresss");
            }

        });

        /*
            This section below is to handle all the games events
        */
        // Handle ready event from players
        socket.on("ready", function (payload) {
            // first check if game Ready Check flag is in redis
            rClient.existsAsync(gameReadyCheck)
            .then(function (exist) {
                if (! exist) {
                    // If not exist, set it
                    return rClient.setAsync(gameReadyCheck, true);
                } else {
                    return Promise.resolve(true);
                }
            })
            .then(function () {
                // Then we update the isReady flag for the player to true
                // in Mongo db
                var sqlWhere = {id: socket.id};
                var sqlUpdate = {$set: {isReady: true}};
                return mClient.Game.findOneAndUpdateAsync(sqlWhere, sqlUpdate);
            })
            .then(function(result) {
                // Then we relay the ready event to all others to notify that
                // the player is ready.
                console.log("Marked the player ready in the game table", result);
                // Just relay the payload message
                socket.broadcast.emit("ready", payload);

                // Then we check if we can start the game
                handleGameStart();
            })
            .catch(function (err) {
                console.log("Error Handle socket ready event: ", err);
            });

        }); // End of handling "ready" event

        // Handle event game results.  Expect payload as an array of words
        socket.on("game result", function (payload) {
            // TODO: Code need here to:
            // 1.  Compute the score according to each player payload
            // 2.  Store the word lists and the score of each player
            // 3.  When server received all result from all players
            //     and all score has been computed.  Then send all the result
            //     up to all clients
            var score,
                sqlWhere,
                sqlUpdate;

            console.log("Game Result fired for ", socket.name);
            console.dir(payload);

            // Compute the score for each player as we receive the payload
            // Join all the words in payload and find the length of it
            // we add payload.length as a tie breaker so that whoever come up
            // with more words win
            score = payload.data.join("").length + payload.data.length;

            sqlWhere = {id: socket.id};
            sqlUpdate = {
                $set: {
                    hasResult: true,
                    score: score,
                    wordList: payload.data,
                }
            };
            // We update the game table with the score/wordlist and flag it
            mClient.Game.findOneAndUpdateAsync(sqlWhere, sqlUpdate)
            .then(function (result) {
                // Once updated, we need to see if we can send up the score
                console.log("Update result " + result);
                handleGameResult();
            })
            .catch(function (err) {
                console.log("Error in Game Result event: ", err);
            });

        });

    }); // End of Socket IO events

    console.log("Finished setup the Socket IO server");
};

// Export the module
module.exports.init = initServerIO;
