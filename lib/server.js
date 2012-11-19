var redis = require("redis");

function Hulk() {
  var subscriptions = {};

  // Will look something like:
  // {
  //   'chan1': [a,b,c],
  //   'chan2': [a,b,z]
  // }
  var listeners = {};

  Hulk.remove_listener = function(stream, listener) {
    var stream_listeners = listeners[stream];
    stream_listeners.splice(stream_listeners.indexOf(listener), 1);
    console.log('losing listener');
    // unsubscribe the redis connection if we just dropped the last listener
    // client1.unsubscribe();
    // client1.end();
  };

  Hulk.add_listener = function(stream, listener) {
    if (!listeners[stream]) {
      listeners[stream] = [];
    }

    var stream_listeners = listeners[stream];
    stream_listeners.push(listener);

    if (!subscriptions[stream]) {
      var new_client = redis.createClient();
      subscriptions[stream] = new_client;

      new_client.on("message", function (channel, message) {
        for (var i in listeners[channel]) {
          listeners[channel][i].write("data:" + message + "\n\n");
        }
      });

      new_client.subscribe(stream);
    }

  };

  return Hulk;
}
exports.hulk = Hulk;
