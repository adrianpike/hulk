var Hulk = function(opts) {
  this.opts = opts || {};

  this.subscribe = function(channel, callback) {

    var source = new EventSource('/events/' + channel + '.json');

    source.addEventListener('event', function (event) {
      callback(event);
    }, false);

  };


};
