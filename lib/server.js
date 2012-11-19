var redis = require("redis");

function Hulk() {
  var subscriptions = {};

  // Will look something like:
  // {
  //   'chan1': [a,b,c],
  //   'chan2': [a,b,z]
  // }
  var listeners = {};

  var root_listener = null;

  Hulk.ensure_root_listener = function() {
    if (!root_listener) {
      console.log('Adding default listener');
      var new_client = redis.createClient();
      root_listener = new_client;

      new_client.on("message", function (chan, message) {
        var decoded = JSON.parse(message);
        for (var i in decoded.channels) {
          var channel = decoded.channels[i];
          for (var k in listeners[channel]) { // FIXME: shitty duplication but i'm hacking this out in a coffee shop
            listeners[channel][k].write("data:" + decoded.data + "\n\n");
          }
        }
      });

      new_client.subscribe('juggernaut');
    }
  };

  Hulk.remove_listener = function(stream, listener) {
    var stream_listeners = listeners[stream];
    stream_listeners.splice(stream_listeners.indexOf(listener), 1);
    console.log('losing listener');
    // unsubscribe the redis connection if we just dropped the last listener
    // client1.unsubscribe();
    // client1.end();
  };

  Hulk.add_listener = function(stream, listener) {
    Hulk.ensure_root_listener(); // TODO: if options.juggernaut_compatibility

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
