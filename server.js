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
		successRedirect: '/',
		failureRedirect: '/login',
		failureFlash: true,
	  }
	));

	app.get('/callback', passport.authenticate('oidc',
	  {
		successRedirect: '/',
		failureRedirect: '/login',
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

app.get('/', ensureAuthenticated, function(req, res){
	res.render("index.ejs");
})

app.get('/home', ensureAuthenticated, function(req, res){
	var sql = "SELECT p_title, p_code, p_status, p_org, S1_Name, S2_Name, S3_Name, S4_Name FROM projects WHERE S1_Name = '" + req.user.Name +"' ";
	sql += "OR S2_Name = '" + req.user.name +"'";
	sql += "OR S3_Name = '" + req.user.name +"'";
	sql += "OR S4_Name = '" + req.user.name +"'";
	con.query(sql, function(err, results, fields){
		if(err) throw err;
		console.log(results);
		res.render("home.ejs", {projects: results});
	});
})

app.get('/all', ensureAuthenticated, function(req, res){
	var sql = "SELECT projects.*, grading.status, grading.report, grading.poster FROM projects INNER JOIN grading ON projects.p_code = grading.p_code";
	console.log(sql);
	con.query(sql, function(err, results){
		if(err) throw err;
		console.log(results[0]);
		res.render("all.ejs", {projects: results});
	});
})

app.get('/project/:projectCode', ensureAuthenticated, function(req, res){
	var sql = "SELECT projects.*, grading.p_code, grading.status, grading.report, grading.poster FROM projects INNER JOIN grading ON projects.p_code=grading.p_code WHERE projects.p_code = '" + req.params.projectCode + "'";
	console.log(sql);
	con.query(sql, function(err, results){
		if(err) throw err;
		console.log(results);
		res.render('project.ejs', {project: results, user: req.user.name});
	})
});

app.get('/stop', function(req, res){
	res.render("funny.ejs");
})

app.post('/uploadDocs', ensureAuthenticated, function(req, res){
	var form = new formidable.IncomingForm();
	var c = "";
	var fpath = "";
	var sql1 = "", sql2 = "";
	var validate = false;
	var str = ['S1_Name', 'S2_Name', 'S3_Name', 'S4_Name'];
	form.parse(req);
	form.on('field', function(name, value){
		if(name == 'code'){
			c = value;
			con.query("SELECT S1_Name, S2_Name, S3_Name, S4_Name FROM projects WHERE p_code = '" + c + "'", function(err, results){
				for(var i = 0; i < 4; i++){
					if(results[0][str[i]] == req.user.name){
						validate = true;
						break;
					}
				}
				if(!validate){
					res.redirect("/stop");
				}
			});
		}
		if(name == 'pStatus'){
			if(value == 'Ready to Grade at RC'){
				fpath = "/uploads/Report/" + c + "_report.pdf";
				sql1 = "UPDATE grading SET status = '" + value + "', report = '" + c + "_report.pdf' WHERE p_code = '" + c + "'";
			}else if(value == 'Extension Required'){
				fpath = "/uploads/ExtForm/" + c + "_ext.pdf";
				sql1 = "UPDATE grading SET status = '" + value + "', report = '" + c + "_ext.pdf' WHERE p_code = '" + c + "'";
			}
		}
	});

	form.on('fileBegin', function (name, file){
			file.path = __dirname + fpath;
	});

	form.on('file', function (name, file){
			console.log('Uploaded ' + file.name);
	});

	form.on('end', function(){
		if(validate){
			con.query(sql1, function(err, result){
				if(err) throw err;
				console.log(result);
			})
			res.redirect('/project/'+ c);
		}
	})



});

app.post('/uploadPoster', ensureAuthenticated, function(req, res){
	var form = new formidable.IncomingForm();
	form.parse(req);
	var c = "";
	var sql = "";
	var validate = false;
	var str = ['S1_Name', 'S2_Name', 'S3_Name', 'S4_Name'];
	form.on('field', function(name, value){
		if(name == 'code'){
			c = value;
			con.query("SELECT S1_Name, S2_Name, S3_Name, S4_Name FROM projects WHERE p_code = '" + c + "'", function(err, results){
				for(var i = 0; i < 4; i++){
					if(results[0][str[i]] == req.user.name){
						validate = true;
						break;
					}
				}
				if(!validate){
					res.redirect("/stop");
				}
			});
		}
		sql = "UPDATE grading SET poster = '" + value +"_poster.pdf' WHERE p_code = '" + value + "'";
		console.log(sql);
	});
	form.on('fileBegin', function (name, file){
    	file.path = __dirname + '/uploads/Poster/' + c + '_poster.pdf';
  });
	form.on('end', function(){
		if(validate){
			con.query(sql, function(err, res){
				if(err) throw err;
				console.log(res);
			});
			res.redirect('/project/' + c);
		}
	});
})

app.get('/download/:type/:projectCode', function(req, res){
	res.download(__dirname + "/uploads/" + req.params.type + "/" + req.params.projectCode);
})

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
