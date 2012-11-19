var Hulk = function(opts) {
  this.opts = opts || {};

  this.subscribe = function(channel, callback) {

    var source = new EventSource('/stream.json?stream=' + channel);

    source.addEventListener('message', function(e, data) {
      callback(e.data);
    }, false);

  };


};
