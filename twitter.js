var Twitter = require('node-tweet-stream'),
    async = require('async'), //The async module handles the async flow.
    moment = require('moment'), //Moment is used for datetime parsing/formatting
    fs = require('fs'),
    request = require('request'), //Used to fetch the image from the internet
    rem = require('remedy-rest'), //Used for remedy rest operations
    chalk = require('chalk'),
    commandLineArgs = require('command-line-args'), //Used to color the output.
    twitterSecrets = require('./twitter-secrets'),
    remedyConnectionProperties = require('./remedy-connection');
t = new Twitter(twitterSecrets),
    remedy = rem(remedyConnectionProperties);
    //A template for our broadcasts, 
var templateBroadcast = {
    "BroadcastSubject": "",
    "Company": "Calbro Services",
    "Priority": "Medium",
    "Request Type01": "Broadcast",
    "Broadcast Message": "",
    "Broadcast_Type": "Scheduled Unavailability",
    "Broadcast Start Date": "2016-10-24T12:00:00.000+0000",
    "Broadcast End Date": "2016-10-25T22:00:00.000+0000",
    "Broadcast Number": "----------------------",
    "z1D View Access": "Public",
    "z1D Current BroadcastOperation": "CREATE"
};
var download = function(uri, filename, callback) {
    request.head(uri, function(err, res, body) {
        request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
    });
};
var loginRemedyAndDownloadTweetmedia = function(tweet, callback) {
    /*
    These operations are not dependant on each other so we can do them in parallel
    */
    async.parallel([
        function(innercb) {
            remedy.login(function(err, data) {
                if (!err && data == "ok") {
                    console.log(chalk.yellow("Logged in to remedy"));
                    innercb();
                }
                if (err) {
                    console.dir(err);
                    innercb(err);
                }
            })
        },
        function(innercb) {
            if (!tweet.media_url)
                return innercb();
            var uriparts = tweet.media_url.split('/');
            filename = uriparts[uriparts.length - 1];
            path = __dirname + "/.tmp/";
            download(tweet.media_url, path + filename, innercb);
        }
    ], function(err) {
        //This c
        if (!err)
            console.log(chalk.yellow("Done downloading and we are logged in to remedy"));
        else
            console.log(chalk.red(err));
        callback(err);
    });
}
var createBroadcast = function(tweet, callback) {
    /*
    To be sure that we get a "free" Broadcast number we have to mimic the client behaviour
    and do a create on the TicketNumGenerator. We use the returned entry ID, should be the same as LASTID()
    when we create the broadcast. These operations has to done in order so we use async.series
    */
    async.series([
        function generateTicketNumber(cb) {
            remedy.post({
                path: {
                    schema: "CFG:CFG PBB TicketNumGenerator"
                },
                data: {
                    values: {
                        "Submitter": "tweet"
                    }
                }
            }, function(err, data) {
                if (err) {
                    console.log(err.statusCode);
                    console.log(err.data.toString());
                } else {
                    broadcastnumber = data.entryId;
                    cb();
                }
            });
        },
        function createBroadcastEntry(cb) {
            templateBroadcast["Broadcast Start Date"] = moment().format();;
            templateBroadcast["Broadcast End Date"] = moment().add(5, 'm').format();
            templateBroadcast["BroadcastSubject"] = tweet.header;
            templateBroadcast["Broadcast Message"] = tweet.body;
            templateBroadcast["Broadcast Number"] = broadcastnumber;
            var attachments = null;
            if (tweet.media_url) {
                templateBroadcast["z2AF_BroadcastAttachment"] = filename;
                attachments = {
                    "z2AF_BroadcastAttachment": {
                        path: path + filename
                    }
                }
            } else
                templateBroadcast["z2AF_BroadcastAttachment"] = null;
            var data = {
                values: templateBroadcast
            };
            if (attachments) {
                data.attachments = attachments;
            }
            remedy.post({
                path: {
                    schema: "CFG:Broadcast"
                },
                data: data
            }, function(err, data) {
                if (err) {
                    console.log(chalk.red("ARS Error:"));
                    console.log(err.data.toString());
                    cb(err);
                } else {
                    cb();

                }
            });
        }

    ], function(err) {
        if (err) {
            console.log(err);
        }
        callback(err);
    });
}
var remedypush = function(tweet, callback) {
    var filename = "";
    var path = "";
    var broadcastnumber = "";
    /*
          We want to do the following:
          1.Log in to remedy
          2.Download any tweet media.
          3.Create broadcast.
          We need to be finished with 1 and 2 before doing 3. So we do 1 and 2 together and number 3 
          after they are finished
    */
    async.series([
        function(cb) {
            loginRemedyAndDownloadTweetmedia(tweet, cb);
        },
        function(cb) {
            createBroadcast(tweet, cb);
        }
    ], function(err) {
        if (err) {
            console.log(err);
        } else
            console.log(chalk.green("Tweet submitted to ARS"));
        callback();
    });
}
const optionDefinitions = [{
    name: 'track',
    type: String,
    multiple: true,
    defaultOption: true
}];
const options = commandLineArgs(optionDefinitions);
/*Set up twitter listeners*/
t.on('tweet', function(event) {
    console.log("Tweet Received");
    var header = event.user.name + " Tweeted!";
    var body = event.text;
    var media_url = (event.entities && event.entities.media && event.entities.media.length > 0) ? event.entities.media[0].media_url : null;
    remedypush({
        header: header,
        body: body,
        id: event.id_str,
        media_url: media_url
    }, function(err, ok) {
        if (err) {
            console.log(err);
        }
    })

});
t.on('error', function(error) {
    console.log("We have an error");
    console.log(error);
    throw error;
});
t.on('connect', function() {
    console.log("Connected to twitter");
});
t.on('reconnect', function(type) {
    console.log("Reconnect because" + type.type);
});
t.on('warning', function(warning) {
    console.log("We have received a warning" + warning);
});
if (!options.track) {
    console.log("You need to give at least one thing to follow eg: BMC");
    return 0;
}
//For each tag set on command line set up tracker.
for (var i = 0; i < options.track.length; i++) {
    t.track(options.track[i]);
    console.log("Tracking: " + options.track[i]);
    console.log("Use CTRL + C to quit");
}