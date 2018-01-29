var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var mysql = require('mysql');
var moment = require('moment');
var session = require('express-session');
var passport = require('passport');
var app = express();
var formidable = require('formidable');
var db = require("./config/db.js");
var users = {};

var config = require("./config/config.js");
var Strategy = require('openid-client').Strategy;
var Issuer = require('openid-client').Issuer;
var registerPassport = function (client, params) {
	passport.use('oidc', new Strategy({ client, params }, function (tokenset, done) {
		var email = tokenset.claims.email;
		var name = tokenset.claims.name;
		if (!config.allowed.test(email)) {
			return done(null, false, { message: "Can't login, bad email. " });
		}

		var profile = {
			email,
			name,
			sub: tokenset.claims.sub
		};
		console.log(users);
		users[profile.sub] = profile;
		return done(null, profile);
	}));

	app.get('/login', passport.authenticate('oidc',
	  {
		successRedirect: '/home',
		failureRedirect: '/',
		failureFlash: true,
	  }
	));

	app.get('/callback', passport.authenticate('oidc',
	  {
		successRedirect: '/home',
		failureRedirect: '/',
		failureFlash: true,
	  }
	));
}

app.get('/logout', function(req, res){
    	req.logout();
    	res.redirect("/home");
});

Issuer.defaultHttpOptions = { timeout: 10000 };
Issuer.discover(config.oidc.issuer)
.then(function (issuer) {
	var client = new issuer.Client({
		client_id: config.oidc.client_id,
		client_secret: config.oidc.client_secret,
		redirect_uris: [config.oidc.redirect_uri],
	});
	setTimeout(function(){ // lazy way to ensure these routes are set up last
		registerPassport(client, {
			scope: 'openid profile email'
		});
	}, 1000);
}).catch(function (error) {
	console.error(error);
	process.exit();
});

app.use((req, res, next) => { console.log(req.url); next() });

passport.serializeUser(function(user, done) {
	done(null, user.sub);
});

passport.deserializeUser(function(sub, done) {
	process.nextTick(function() {
		done(null, users[sub]);
	});
});

//view engine setup
app.set('view engine', 'ejs');

//app.use(express.methodOverride());
app.use(cookieParser());

//Session setup
app.use(session({
	secret:'keyboard cat', resave: true, saveUninitialized: false
}));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(passport.initialize());
app.use(passport.session());

app.use('/', express.static('./public'));

var con = mysql.createConnection({
	host: db.host,
	user: db.user,
	password: db.password,
	database: db.database
});

con.connect(function(err){
	if (err) throw err;
	console.log("connected");
})


//routes=======================================================================

app.get('/home', ensureAuthenticated, function(req, res){
	var sql = "SELECT p_title, p_code, p_status, p_org, S1_Name, S2_Name, S3_Name, S4_Name FROM projects WHERE S1_NAME = '" + req.user.name +"' ";
	sql += "OR S2_NAME = '" + req.user.name +"'";
	sql += "OR S3_NAME = '" + req.user.name +"'";
	sql += "OR S4_NAME = '" + req.user.name +"'";
	con.query(sql, function(err, results, fields){
		if(err) throw err;
		//console.log(results);
		res.render("index.ejs", {projects: results});
	});
})

app.get('/project/:projectCode', ensureAuthenticated, function(req, res){
	var sql = "SELECT * FROM projects WHERE p_code = '" + req.params.projectCode + "'";
	con.query(sql, function(err, results){
		if(err) throw err;
		console.log(results);
		res.render('project.ejs', {project: results, user: req.user.name});
	})
});

//=============================================================================

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  res.redirect('/login');
};

 var server = app.listen(8080, function(){
 	var host = server.address().address;
 	var port = server.address().port;

 	console.log('App listening at http://%s:%s', host, port);
 });
