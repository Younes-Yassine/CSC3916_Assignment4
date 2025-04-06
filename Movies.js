var mongoose = require('mongoose');
var Schema = mongoose.Schema;

mongoose.connect(process.env.DB);

var MovieSchema = new Schema({
    title: { type: String, required: true },
    director: String,
    genre: String,
    year: Number
});

module.exports = mongoose.model('Movie', MovieSchema);
