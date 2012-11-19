var redis = require("redis");

function Hulk() {
  var streams = {};

  var remove_listener = function(stream, listener) {
    var stream_listeners = streams[stream] || streams['*'];
    stream_listeners.splice(stream_listeners.indexOf(res), 1);
    // unsubscribe the redis connection
  };

  var add_listener = function(stream, listener) {
    var stream_listeners = streams[stream] || streams['*'];

    // subscribe the redis connection
  };

  return Hulk;
}
exports.hulk = Hulk;
