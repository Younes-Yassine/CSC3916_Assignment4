/*
CSC3916 HW4
File: server.js
Description: Web API scaffolding for Movie API with Reviews and Analytics
*/

var express = require('express');
var bodyParser = require('body-parser');
var passport = require('passport');
var authController = require('./auth');
var authJwtController = require('./auth_jwt');
var jwt = require('jsonwebtoken');
var cors = require('cors');
var User = require('./Users');
var Movie = require('./Movies');
var Review = require('./Reviews');
var mongoose = require('mongoose');
var crypto = require("crypto");
var rp = require('request-promise');

var app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(passport.initialize());

var router = express.Router();


const GA_TRACKING_ID = process.env.GA_KEY;
function trackDimension(category, action, label, value, dimension, metric) {
    var options = { 
        method: 'GET',
        url: 'https://www.google-analytics.com/collect',
        qs: {   
            v: '1', // API Version.
            tid: GA_TRACKING_ID, // Tracking ID / Property ID.
            cid: crypto.randomBytes(16).toString("hex"), // Random Client Identifier.
            t: 'event', // Event hit type.
            ec: category, // Event category.
            ea: action, // Event action.
            el: label, // Event label.
            ev: value, // Event value.
            cd1: dimension, // Custom Dimension (Movie Title)
            cm1: metric  // Custom Metric (Requested count)
        },
        headers: { 'Cache-Control': 'no-cache' }
    };
    return rp(options);
}

// Utility function for debugging (not essential)
function getJSONObjectForMovieRequirement(req) {
    var json = {
        headers: "No headers",
        key: process.env.UNIQUE_KEY,
        body: "No body"
    };

    if (req.body != null) {
        json.body = req.body;
    }
    if (req.headers != null) {
        json.headers = req.headers;
    }
    return json;
}

// User Signup
router.post('/signup', function(req, res) {
    if (!req.body.username || !req.body.password) {
        return res.json({success: false, msg: 'Please include both username and password to signup.'});
    } 
    var user = new User();
    user.name = req.body.name;
    user.username = req.body.username;
    user.password = req.body.password;

    user.save(function(err){
        if (err) {
            if (err.code == 11000)
                return res.json({ success: false, message: 'A user with that username already exists.'});
            else
                return res.json(err);
        }
        res.json({success: true, msg: 'Successfully created new user.'});
    });
});

// User Signin
router.post('/signin', function (req, res) {
    var userNew = new User();
    userNew.username = req.body.username;
    userNew.password = req.body.password;

    User.findOne({ username: userNew.username }).select('name username password').exec(function(err, user) {
        if (err) {
            return res.send(err);
        }
        if (!user) {
            return res.status(401).send({success: false, msg: 'Authentication failed.'});
        }
        user.comparePassword(userNew.password, function(isMatch) {
            if (isMatch) {
                var userToken = { id: user.id, username: user.username };
                var token = jwt.sign(userToken, process.env.SECRET_KEY);
                res.json ({success: true, token: 'JWT ' + token});
            } else {
                res.status(401).send({success: false, msg: 'Authentication failed.'});
            }
        });
    });
});


router.route('/reviews')
    
    .get(function(req, res) {
        Review.find({}, function(err, reviews) {
            if(err) return res.status(500).json(err);
            res.json(reviews);
        });
    })
  
    .post(authJwtController.isAuthenticated, function(req, res) {
        if(!req.body.movieId || !req.body.username || !req.body.review || req.body.rating == null) {
            return res.status(400).json({ message: "Missing required fields."});
        }
        var review = new Review({
            movieId: req.body.movieId,
            username: req.body.username,
            review: req.body.review,
            rating: req.body.rating
        });
        review.save(function(err, savedReview) {
            if(err) {
                return res.status(500).json(err);
            }
            
            Movie.findById(review.movieId, function(err, movie) {
                if(movie) {
                    trackDimension(movie.genre || "Unknown", "POST /reviews", "API Request for Movie Review", 1, movie.title, 1)
                        .then(function(response){
                            console.log("Analytics event tracked");
                        })
                        .catch(function(err){
                            console.error("Analytics event error: ", err);
                        });
                }
                res.json({ message: 'Review created!' });
            });
        });
    });


router.delete('/reviews/:id', authJwtController.isAuthenticated, function(req, res) {
    Review.findByIdAndRemove(req.params.id, function(err, review) {
        if(err) return res.status(500).json(err);
        res.json({ message: "Review deleted!" });
    });
});


router.get('/movies/:id', function(req, res) {
    if(req.query.reviews && req.query.reviews === "true") {
        let movieId;
        try {
            movieId = mongoose.Types.ObjectId(req.params.id);
        } catch(e) {
            return res.status(400).json({ error: "Invalid movie id" });
        }
        Movie.aggregate([
            { $match: { _id: movieId } },
            { $lookup: {
                  from: "reviews",
                  localField: "_id",
                  foreignField: "movieId",
                  as: "reviews"
              } }
        ]).exec(function(err, result) {
            if(err) return res.status(500).json(err);
            if(result.length === 0)
                return res.status(404).json({ error: "Movie not found" });
            res.json(result[0]);
        });
    } else {
        Movie.findById(req.params.id, function(err, movie) {
            if(err) return res.status(500).json(err);
            if(!movie) return res.status(404).json({ error: "Movie not found" });
            res.json(movie);
        });
    }
});


router.get('/movies', function(req, res) {
    Movie.find({}, function(err, movies) {
        if(err) return res.status(500).json(err);
        res.json(movies);
    });
});

app.use('/', router);
app.listen(process.env.PORT || 8080);
module.exports = app; 
