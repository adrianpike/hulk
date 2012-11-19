var CONFIG = require('config');

if (CONFIG.ssl) {
  var path     = require("path");
  var fs       = require("fs");
  var http     = require('https');

  var credentials;
  var keysPath = __dirname + "/keys";
  if (path.existsSync(keysPath + "/privatekey.pem") && path.existsSync(keysPath + "/certificate.pem")) {
    var privateKey = fs.readFileSync(keysPath + "/privatekey.pem", "utf8");
    var certificate = fs.readFileSync(keysPath + "/certificate.pem", "utf8");
    var ca = fs.readFileSync(keysPath + "/ca.pem", "utf8");

    credentials = {key: privateKey, cert: certificate, ca: ca};
  }
}

var express = require("express");
var Lactate = require('lactate');
var Hulk = require('./lib/server.js').hulk({});

var lactate = Lactate.Lactate();
lactate.set({
  root:process.cwd(),
  expires:'1 day'
});

var app = express();
app.use(express.bodyParser());

app.get('/application.js', function(req, res) {
  lactate.serve('lib/client.js', req, res);
});
app.get('/hulk.js', function(req, res) {
  lactate.serve('lib/client.js', req, res);
});

app.get('/test', function(req, res) {
  lactate.serve('test.html', req, res);
});


app.get('/stream/:stream.json', function(req, res) {
  res.header('Content-Type', 'text/event-stream');
  res.header('Cache-Control', 'no-cache');
  res.header('Connection', 'keep-alive');

  console.log('New listener on', stream);
  Hulk.add_listener(stream, res);

  res.on('close', function() {
    Hulk.remove_listener(stream, res);
  });

});

console.log('Hulk running at http://127.0.0.1:' + CONFIG.port + '/');

if (credentials) {
  https = http.createServer(credentials, app);
  https.listen(CONFIG.port);
} else {
  app.listen(CONFIG.port);
}
