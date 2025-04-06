/*
CSC3916 HW4
File: server.js
Description: Web API scaffolding for Movie API with Reviews and Analytics (with Debug Logging)
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

// Google Analytics Tracking Function with debug logging
const GA_TRACKING_ID = process.env.GA_KEY;
function trackDimension(category, action, label, value, dimension, metric) {
    console.log("Tracking event:", { category, action, label, value, dimension, metric });
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

// Utility function for debugging request details
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
    console.log("Request debug info:", json);
    return json;
}

// User Signup
router.post('/signup', function(req, res) {
    console.log("Signup request body:", req.body);
    if (!req.body.username || !req.body.password) {
        console.error("Signup error: Missing username or password");
        return res.json({ success: false, msg: 'Please include both username and password to signup.' });
    } 
    var user = new User();
    user.name = req.body.name;
    user.username = req.body.username;
    user.password = req.body.password;

    user.save(function(err) {
        if (err) {
            console.error("Error during signup:", err);
            if (err.code == 11000)
                return res.json({ success: false, message: 'A user with that username already exists.' });
            else
                return res.json(err);
        }
        console.log("User created:", user.username);
        res.json({ success: true, msg: 'Successfully created new user.' });
    });
});

// User Signin
router.post('/signin', function (req, res) {
    console.log("Signin request body:", req.body);
    var userNew = new User();
    userNew.username = req.body.username;
    userNew.password = req.body.password;

    User.findOne({ username: userNew.username }).select('name username password').exec(function(err, user) {
        if (err) {
            console.error("Signin error:", err);
            return res.send(err);
        }
        if (!user) {
            console.error("Signin failed: User not found");
            return res.status(401).send({ success: false, msg: 'Authentication failed.' });
        }
        user.comparePassword(userNew.password, function(isMatch) {
            if (isMatch) {
                var userToken = { id: user.id, username: user.username };
                var token = jwt.sign(userToken, process.env.SECRET_KEY);
                console.log("User authenticated:", user.username);
                res.json({ success: true, token: 'JWT ' + token });
            } else {
                console.error("Signin failed: Password mismatch");
                res.status(401).send({ success: false, msg: 'Authentication failed.' });
            }
        });
    });
});

// Reviews Routes
router.route('/reviews')
    .get(function(req, res) {
        console.log("Fetching all reviews");
        Review.find({}, function(err, reviews) {
            if (err) {
                console.error("Error fetching reviews:", err);
                return res.status(500).json(err);
            }
            console.log("Fetched reviews count:", reviews.length);
            res.json(reviews);
        });
    })
    .post(authJwtController.isAuthenticated, function(req, res) {
        console.log("Create review request body:", req.body);
        if (!req.body.movieId || !req.body.username || !req.body.review || req.body.rating == null) {
            console.error("Create review error: Missing required fields");
            return res.status(400).json({ message: "Missing required fields." });
        }
        var review = new Review({
            movieId: req.body.movieId,
            username: req.body.username,
            review: req.body.review,
            rating: req.body.rating
        });
        review.save(function(err, savedReview) {
            if (err) {
                console.error("Error saving review:", err);
                return res.status(500).json(err);
            }
            console.log("Review saved with ID:", savedReview._id);
            // After saving, track analytics event.
            Movie.findById(review.movieId, function(err, movie) {
                if (err) {
                    console.error("Error finding movie for analytics:", err);
                }
                if (movie) {
                    console.log("Found movie for analytics:", movie.title);
                    trackDimension(
                        movie.genre || "Unknown", 
                        "POST /reviews", 
                        "API Request for Movie Review", 
                        1, 
                        movie.title, 
                        1
                    )
                    .then(function(response) {
                        console.log("Analytics event tracked");
                    })
                    .catch(function(err) {
                        console.error("Analytics event error:", err);
                    });
                } else {
                    console.warn("Movie not found for review analytics");
                }
                res.json({ message: 'Review created!' });
            });
        });
    });

// Delete a Review
router.delete('/reviews/:id', authJwtController.isAuthenticated, function(req, res) {
    console.log("Delete review with ID:", req.params.id);
    Review.findByIdAndRemove(req.params.id, function(err, review) {
        if (err) {
            console.error("Error deleting review:", err);
            return res.status(500).json(err);
        }
        console.log("Review deleted:", req.params.id);
        res.json({ message: "Review deleted!" });
    });
});

// Get Specific Movie (with optional reviews aggregation)
router.get('/movies/:id', function(req, res) {
    console.log("Fetching movie by ID:", req.params.id, "Query:", req.query);
    if (req.query.reviews && req.query.reviews === "true") {
        let movieId;
        try {
            movieId = mongoose.Types.ObjectId(req.params.id);
        } catch(e) {
            console.error("Invalid movie id format:", req.params.id);
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
            if (err) {
                console.error("Error during aggregation for movie reviews:", err);
                return res.status(500).json(err);
            }
            if (result.length === 0) {
                console.warn("Movie not found with ID:", req.params.id);
                return res.status(404).json({ error: "Movie not found" });
            }
            console.log("Aggregated movie data:", result[0]);
            res.json(result[0]);
        });
    } else {
        Movie.findById(req.params.id, function(err, movie) {
            if (err) {
                console.error("Error fetching movie:", err);
                return res.status(500).json(err);
            }
            if (!movie) {
                console.warn("Movie not found with ID:", req.params.id);
                return res.status(404).json({ error: "Movie not found" });
            }
            console.log("Fetched movie:", movie);
            res.json(movie);
        });
    }
});

// Get All Movies
router.get('/movies', function(req, res) {
    console.log("Fetching all movies");
    Movie.find({}, function(err, movies) {
        if (err) {
            console.error("Error fetching movies:", err);
            return res.status(500).json(err);
        }
        console.log("Fetched movies count:", movies.length);
        res.json(movies);
    });
});

app.use('/', router);
app.listen(process.env.PORT || 8080, function() {
    console.log("Server is running on port " + (process.env.PORT || 8080));
});
module.exports = app;
