'use strict';
// This file is surely full of error. I have to say that I try to understand how it works by copying / modifying code from other plugins.
// as result plenty of line should be removed or added...
// not sure all var are required....
var io = require('socket.io-client');
var fs = require('fs-extra');
var libFsExtra = require('fs-extra');
var exec = require('child_process').exec;
var libQ = require('kew');
var libNet = require('net');
//var libFast = require('fast.js');
var config = new(require('v-conf'))();



// Define the ControllerBrutefir class
module.exports = ControllerBrutefir;
function ControllerBrutefir(context) {
 // This fixed variable will let us refer to 'this' object at deeper scopes
 var self = this;

 this.context = context;
 this.commandRouter = this.context.coreCommand;
 this.logger = this.context.logger;
 this.configManager = this.context.configManager;

}

ControllerBrutefir.prototype.onVolumioStart = function() {
 var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
 this.config = new(require('v-conf'))();
 this.config.loadFile(configFile);
}

ControllerBrutefir.prototype.getConfigurationFiles = function()
{
 return ['config.json'];
};

// Plugin methods -----------------------------------------------------------------------------

ControllerBrutefir.prototype.startBrutefirDaemon = function() {
 var self = this;

 var defer = libQ.defer();

  exec("/usr/bin/sudo /bin/systemctl start brutefir.service", {uid: 1000,gid: 1000}, function(error, stdout, stderr) {
  if (error !== null) {
   self.commandRouter.pushConsoleMessage('The following error occurred while starting Brutefir: ' + error);
   defer.reject();
  } else {
   self.commandRouter.pushConsoleMessage('Brutefir Daemon Started');
   defer.resolve();
  }
 });
 return defer.promise;
};

ControllerBrutefir.prototype.brutefirDaemonConnect = function(defer) {
 var self = this;

 // TODO use names from the package.json instead
 self.servicename = 'brutefir';
 self.displayname = 'Brutefir';


 // Each core gets its own set of Brutefir sockets connected

 var nHost = 'localhost';
 var nPort = 3002;
 self.connBrutefirCommand = libNet.createConnection(nPort, nHost);
 self.connBrutefirStatus = libNet.createConnection(nPort, nHost, function() {
//  self.addToBrowseSources();
  defer.resolve();
 }); // Socket to listen for status changes

 // Start a listener for receiving errors

 self.connBrutefirCommand.on('error', function(err) {
  self.logger.info('BRUTEFIR status error:');
  self.logger.info(err);
  try {
   defer.reject();
  } catch (ecc) {}


 });
 self.connBrutefirStatus.on('error', function(err) {
  self.logger.info('Brutefir status error:');
  self.logger.info(err);

  try {
   defer.reject();
  } catch (ecc) {}
 });
 // Init some command socket variables
 self.bBrutefirCommandGotFirstMessage = false;
 self.brutefirCommandReadyDeferred = libQ.defer(); // Make a promise for when the Brutefir connection is ready to receive events (basically when it emits 'spop 0.0.1').
 self.brutefirCommandReady = self.brutefirCommandReadyDeferred.promise;
 self.arrayResponseStack = [];
 self.sResponseBuffer = '';

 // Start a listener for command socket messages (command responses)
 self.connBrutefirCommand.on('data', function(data) {
  self.sResponseBuffer = self.sResponseBuffer.concat(data.toString());

  // If the last character in the data chunk is a newline, this is the end of the response
  if (data.slice(data.length - 1).toString() === '\n') {

   self.commandRouter.logger.info("FIRST BRANCH");
   // If this is the first message, then the connection is open
   if (!self.bBrutefirCommandGotFirstMessage) {
    self.bBrutefirCommandGotFirstMessage = true;
    try {
     self.brutefirCommandReadyDeferred.resolve();
    } catch (error) {
     self.pushError(error);
    }
    // Else this is a command response
   } else {
    try {
     self.commandRouter.logger.info("BEFORE: BRUTEFIR HAS " + self.arrayResponseStack.length + " PROMISE IN STACK");

     if (self.arrayResponseStack !== undefined && self.arrayResponseStack.length > 0)
      self.arrayResponseStack.shift().resolve(self.sResponseBuffer);

     self.commandRouter.logger.info("AFTER: BRUTEFIR HAS " + self.arrayResponseStack.length + " PROMISE IN STACK");

    } catch (error) {
     self.pushError(error);
    }
   }

   // Reset the response buffer
   self.sResponseBuffer = '';
  }
 });

 // Init some status socket variables
 self.bBrutefirStatusGotFirstMessage = false;
 self.sStatusBuffer = '';

 // Start a listener for status socket messages
 self.connBrutefirStatus.on('data', function(data) {
  self.sStatusBuffer = self.sStatusBuffer.concat(data.toString());

  // If the last character in the data chunk is a newline, this is the end of the status update
  if (data.slice(data.length - 1).toString() === '\n') {
   // Put socket back into monitoring mode
   self.connBrutefirStatus.write('idle\n');

   // If this is the first message, then the connection is open
   if (!self.bBrutefirStatusGotFirstMessage) {
    self.bBrutefirStatusGotFirstMessage = true;
    // Else this is a state update announcement
   } else {
    var timeStart = Date.now();
    var sStatus = self.sStatusBuffer;

    self.commandRouter.logger.info("STATUS");

    self.commandRouter.logger.info(sStatus);

    self.logStart('Brutefir announces state update')
     /*.then(function(){
      return self.getState.call(self);
      })*/
     .then(function() {
      return self.parseState.call(self, sStatus);
     })
     .then(libFast.bind(self.pushState, self))
     .fail(libFast.bind(self.pushError, self))
     .done(function() {
      return self.logDone(timeStart);
     });
   }

   // Reset the status buffer
   self.sStatusBuffer = '';
  }
 });



};


ControllerBrutefir.prototype.onStop = function() {
 var self = this;
 self.logger.info("Stopping Brutefir service");
//exec("killall brutefir.real", function(error, stdout, stderr) {
exec("/usr/bin/sudo /bin/systemctl stop brutefir.service", {uid: 1000,gid: 1000}, function(error, stdout, stderr) {
 });
 return libQ.resolve();
};


ControllerBrutefir.prototype.onStart = function() {
 var self = this;

 var defer = libQ.defer();
 self.startBrutefirDaemon()
  .then(function(e) 
	{
   setTimeout(function() {
    self.logger.info("Connecting to daemon brutefir");
    self.brutefirDaemonConnect(defer);
   }, 5000);
  })
  .fail(function(e) {
   defer.reject(new Error());
  });

 this.commandRouter.sharedVars.registerCallback('alsa.outputdevice', this.rebuildBRUTEFIRAndRestartDaemon.bind(this));
 return defer.promise;
};

ControllerBrutefir.prototype.handleBrowseUri = function(curUri) {
 var self = this;

 //self.commandRouter.logger.info(curUri);
 var response;

 if (curUri.startsWith('brutefir')) {
  if (curUri == 'brutefir') 
	{
   response = libQ.resolve({
    navigation: {
     prev: {
      uri: 'brutefir'
     },
     list: [{
       service: 'brutefir',
       type: 'folder',
       icon: 'fa fa-folder-open-o',
       uri: 'brutefir'
      }

     ]
    }
   });
  }
 }

 return response;
};

ControllerBrutefir.prototype.onRestart = function() {
 var self = this;

};

ControllerBrutefir.prototype.onInstall = function() {
 var self = this;
	
 //	//Perform your installation tasks here
};

ControllerBrutefir.prototype.onUninstall = function() {
 var self = this;
 //Perform your installation tasks here
};

ControllerBrutefir.prototype.getUIConfig = function() {
 	var self = this;
	var defer = libQ.defer();

	var lang_code = this.commandRouter.sharedVars.get('language_code');
	 //var language_code = config.get('language_code');
	self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
		__dirname+'/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function(uiconf)
		{

//var uiconf = libFsExtra.readJsonSync(__dirname + '/UIConfig.json');
var value;	
//{		
 var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');

 uiconf.sections[0].content[1].value = self.config.get('coef31');
 uiconf.sections[0].content[2].value = self.config.get('coef63');
 uiconf.sections[0].content[3].value = self.config.get('coef125');
 uiconf.sections[0].content[4].value = self.config.get('coef250');
 uiconf.sections[0].content[5].value = self.config.get('coef500');
 uiconf.sections[0].content[6].value = self.config.get('coef1000');
 uiconf.sections[0].content[7].value = self.config.get('coef2000');
 uiconf.sections[0].content[8].value = self.config.get('coef4000');
 uiconf.sections[0].content[9].value = self.config.get('coef8000');
 uiconf.sections[0].content[10].value = self.config.get('coef16000');
 uiconf.sections[0].content[11].value = self.config.get('phas31');
 uiconf.sections[0].content[12].value = self.config.get('phas63');
 uiconf.sections[0].content[13].value = self.config.get('phas125');
 uiconf.sections[0].content[14].value = self.config.get('phas250');
 uiconf.sections[0].content[15].value = self.config.get('phas500');
 uiconf.sections[0].content[16].value = self.config.get('phas1000');
 uiconf.sections[0].content[17].value = self.config.get('phas2000');
 uiconf.sections[0].content[18].value = self.config.get('phas4000');
 uiconf.sections[0].content[19].value = self.config.get('phas8000');
 uiconf.sections[0].content[20].value = self.config.get('phas16000');
 uiconf.sections[1].content[2].value = self.config.get('leftfilter');
 uiconf.sections[1].content[3].value = self.config.get('rightfilter');
 
value = self.config.get('attenuation');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[1].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[1].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[1].options'), value));

// uiconf.sections[1].content[1].value = self.config.get('attenuation');
value = self.config.get('filter_size');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[4].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[4].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[4].options'), value));

// uiconf.sections[1].content[4].value = self.config.get('filter_size');
 
value = self.config.get('numb_part');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[5].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[5].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[5].options'), value));
//uiconf.sections[1].content[5].value = self.config.get('numb_part');
value = self.config.get('fl_bits');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[6].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[6].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[6].options'), value));
// uiconf.sections[1].content[6].value = self.config.get('fl_bits');
value = self.config.get('smpl_rate');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[7].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[7].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[7].options'), value));
// uiconf.sections[1].content[7].value = self.config.get('smpl_rate');
value = self.config.get('input_format');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[8].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[8].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[8].options'), value));
//  uiconf.sections[1].content[8].value = self.config.get('input_format');
value = self.config.get('output_format');
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[9].value.value', value);
	self.configManager.setUIConfigParam(uiconf, 'sections[1].content[9].value.label', self.getLabelForSelect(self.configManager.getValue(uiconf, 'sections[1].content[9].options'), value));
// uiconf.sections[1].content[9].value = self.config.get('output_format')
var value;	
 uiconf.sections[1].content[10].value = self.config.get('input_device');
 uiconf.sections[1].content[11].value = self.config.get('output_device');

//self.configManager.setUIConfigParam(uiconf, 'sections[1].content[9].id', 'output_format');
// return uiconf;
//}
	defer.resolve(uiconf);
		})
		.fail(function()
		{
			defer.reject(new Error());
		})
	return defer.promise

//return uiconf;

};

ControllerBrutefir.prototype.getLabelForSelect = function (options, key) {
	var n = options.length;
	for (var i = 0; i < n; i++) {
		if (options[i].value == key)
			return options[i].label;
	}

	return 'VALUE NOT FOUND BETWEEN SELECT OPTIONS!';
};


ControllerBrutefir.prototype.setUIConfig = function(data) {
 var self = this;
 // var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');

};

ControllerBrutefir.prototype.getConf = function(varName) {
 var self = this;
 //Perform your installation tasks here
};


ControllerBrutefir.prototype.setConf = function(varName, varValue) {
 var self = this;
 //Perform your installation tasks here
};
// Public methods ---------------------------------------------------------------

// Internal Methods ---------------------------------------------------------------------------------------

// burtefir command - until now send nothing....
ControllerBrutefir.prototype.setConf = function(varName, varValue) {
 var self = this;
 //Perform your installation tasks here
};
// Public methods ---------------------------------------------------------------

// Internal Methods ---------------------------------------------------------------------------------------

// burtefir command - until now send nothing....
ControllerBrutefir.prototype.sendgainequalizer = function(coef) {
 var self = this;
// var defer = libQ.defer();
self.config.set('coef31', data['coef31']);
 self.config.set('coef63', data['coef63']);
 self.config.set('coef125', data['coef125']);
 self.config.set('coef250', data['coef250']);
 self.config.set('coef500', data['coef500']);
 self.config.set('coef1000', data['coef1000']);
 self.config.set('coef2000', data['coef2000']);
 self.config.set('coef4000', data['coef4000']);
 self.config.set('coef8000', data['coef8000']);
 self.config.set('coef16000', data['coef16000']);

/*
uiconf.sections[0].content[1].value = self.config.get('coef31');
 uiconf.sections[0].content[2].value = self.config.get('coef63');
 uiconf.sections[0].content[3].value = self.config.get('coef125');
 uiconf.sections[0].content[4].value = self.config.get('coef250');
 uiconf.sections[0].content[5].value = self.config.get('coef500');
 uiconf.sections[0].content[6].value = self.config.get('coef1000');
 uiconf.sections[0].content[7].value = self.config.get('coef2000');
 uiconf.sections[0].content[8].value = self.config.get('coef4000');
 uiconf.sections[0].content[9].value = self.config.get('coef8000');
 uiconf.sections[0].content[10].value = self.config.get('coef16000');
*/
var coef = new Object();

coef.coef31 = '31/' + coef31;
coef.coef63 = '63/'+ coef63,
coef.coef125 = '125/'+ coef125,
coef.coef250 = '250/'+ coef250,
coef.coef500 = '500/'+ coef500,
coef.coef1000 = '1000/'+ coef1000,
coef.coef2000 = '2000/'+ coef2000,
coef.coef4000 = '4000/'+ coef4000,
coef.coef8000 = '8000/'+ coef8000,
coef.coef16000 = '16000/'+ coef16000


//console.log(JSON.stringify(coef))
var json = JSON.stringify(coef);
console.log(json);

 self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerBrutefir::lmc eq 0 (JSON.stringify(coef))');
self.commandRouter.pushToastMessage('[' + Date.now() + '] ' + 'ControllerBrutefir::lmc eq 0 (JSON.stringify(coef))');
 // brutefir cmd
 return self.sendBrutefirCommand('lmc eq 0 (JSON.stringify(coef))');

};

ControllerBrutefir.prototype.sendBrutefirCommand = function(sCommand, arrayParameters) {
 var self = this;
 self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerBrutefir::sendBrutefirCommand');

/*var sParameters = libFast.reduce(arrayParameters, function(sCollected, sCurrent) {
		return sCollected + ' ' + sCurrent;
	}, '');
*/
 // Pass the command to Brutefir when the command socket is ready
 
var brutefirResponseDeferred= lobQ.defer();
self.brutefirCommandReady
  .then(function() {
   return libQ.nfcall(libFast.bind(self.connBrutefirCommand.write, self.connBrutefirCommand), sCommand + sParameters + '\n', 'utf-8');
  });

 var brutefirResponse = brutefirResponseDeferred.promise;
	 if(sCommand!=='status')
    {
        self.commandRouter.logger.info("ADDING DEFER FOR COMMAND " + sCommand);
        self.arrayResponseStack.push(brutefirResponseDeferred);
    }

 // Return a promise for the command response
 return brutefirResponse;
};
/*
ControllerBrutefir.prototype.onStop = function() {
 var self = this;
 exec("killall brutefir.real", function(error, stdout, stderr) {

 });
 return libQ.defer();
};
*/
ControllerBrutefir.prototype.sendphasequalizer = function() {
 var self = this;
 uiconf.sections[0].content[1].value = self.config.get('phas31');
 uiconf.sections[0].content[2].value = self.config.get('phas63');
 uiconf.sections[0].content[3].value = self.config.get('phas125');
 uiconf.sections[0].content[4].value = self.config.get('phas250');
 uiconf.sections[0].content[5].value = self.config.get('phas500');
 uiconf.sections[0].content[6].value = self.config.get('phas1000');
 uiconf.sections[0].content[7].value = self.config.get('phas2000');
 uiconf.sections[0].content[8].value = self.config.get('phas4000');
 uiconf.sections[0].content[9].value = self.config.get('phas8000');
 uiconf.sections[0].content[10].value = self.config.get('phas16000');

 self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerBrutefir::lmc eq 0 phase 31/' + coef31, ', 63/' + coef63, ', 125/' + coef125, ', 250/' + coef250, ', 500/' + coef500, ', 1000/' + coef1000, ', 2000/' + coef2000, ', 4000/' + coef4000, ', 8000/' + coef8000, ', 16000/' + coef16000);

 // brutefir cmd
 //return self.sendBrutefirCommand('lmc eq 0 phase 31/' + phas31, ', 63/' + phas63, ', 125/' + phas125, ', 250/' + phas250, ', 500/' + phas500, ', 1000/' + phas1000, ', 2000/' + phas2000, ', 4000/' + phas4000, ', 8000/' + phas8000, ', 16000/' + phas16000);
return self.sendBrutefirCommand('lmc eq 0 phase 1000/' + phas1000);
};



ControllerBrutefir.prototype.createBRUTEFIRFile = function() {
 var self = this;

 var defer = libQ.defer();


 try {

  fs.readFile(__dirname + "/brutefir.conf.tmpl", 'utf8', function(err, data) {
   if (err) {
    defer.reject(new Error(err));
    return console.log(err);
   }
   /* input for brutefir config is the output set in playback
   and output in brutefir config is hardware in use
   */
 //  var indev = self.commandRouter.sharedVars.get('alsa.outputdevice');
   /* the right device is not properly selected - have to remove 1 - need investigation
    */
  // var inter = indev;
   //var bindev = 'hw:Loopback,1';
   /*brutefir output dev - don't know how to detect- so set manually
    */
   //var outdev = self.commandRouter.sharedVars.get('alsa.outputdevice');
   //var intero = 1;
   //var boutdev = 'hw:' + intero;
   var conf1 = data.replace("${smpl_rate}", self.config.get('smpl_rate'));
   var conf2 = conf1.replace("${filter_size}", self.config.get('filter_size'));
   var conf3 = conf2.replace("${numb_part}", self.config.get('numb_part'));
   var conf4 = conf3.replace("${fl_bits}", self.config.get('fl_bits'));
   var conf5 = conf4.replace("${input_device}", self.config.get('input_device'));
   var conf6 = conf5.replace("${input_format}", self.config.get('input_format'));
   var conf7 = conf6.replace("${attenuation1}", self.config.get('attenuation'));
   var conf8 = conf7.replace("${attenuation2}", self.config.get('attenuation'));
   var conf9 = conf8.replace("${leftfilter}", self.config.get('leftfilter'));
   var conf10 = conf9.replace("${rightfilter}", self.config.get('rightfilter'));
   var conf11 = conf10.replace("${output_device}", self.config.get('output_device'));
   var conf12 = conf11.replace("${output_format}", self.config.get('output_format'));

   fs.writeFile("/data/configuration/miscellanea/brutefir/volumio-brutefir-config", conf12, 'utf8', function(err) {
    if (err)
     defer.reject(new Error(err));
    else defer.resolve();
   });


  });


 } catch (err) {


 }

 return defer.promise;

};


ControllerBrutefir.prototype.saveBrutefirconfigAccount1 = function(data) {
 var self = this;
 var defer = libQ.defer();

self.config.set('coef31', data['coef31']);
 self.config.set('coef63', data['coef63']);
 self.config.set('coef125', data['coef125']);
 self.config.set('coef250', data['coef250']);
 self.config.set('coef500', data['coef500']);
 self.config.set('coef1000', data['coef1000']);
 self.config.set('coef2000', data['coef2000']);
 self.config.set('coef4000', data['coef4000']);
 self.config.set('coef8000', data['coef8000']);
 self.config.set('coef16000', data['coef16000']);
 self.config.set('phas31', data['phas31']);
 self.config.set('phas63', data['phas63']);
 self.config.set('phas125', data['phas125']);
 self.config.set('phas250', data['phas250']);
 self.config.set('phas500', data['phas500']);
 self.config.set('phas1000', data['phas1000']);
 self.config.set('phas2000', data['phas2000']);
 self.config.set('phas4000', data['phas4000']);
 self.config.set('phas8000', data['phas8000']);
 self.config.set('phas16000', data['phas16000']);

/*self.config.set('bandEqualizer', data['bandEqualizer']);
 self.config.set('equalizerSelector', data['equalizerSelector']);*/
self.logger.info('Configurations have been set');


	self.commandRouter.pushToastMessage('success', "Configuration update", 'Configuration has been successfully updated');

	defer.resolve({});

 return defer.promise;
};



ControllerBrutefir.prototype.saveBrutefirconfigAccount2 = function(data) {
 var self = this;

 var defer = libQ.defer();
 self.config.set('attenuation', data['attenuation'].value);
 self.config.set('smpl_rate', data['smpl_rate'].value);
 self.config.set('leftfilter', data['leftfilter']);
 self.config.set('rightfilter', data['rightfilter']);
 self.config.set('filter_size', data['filter_size'].value);
 self.config.set('numb_part', data['numb_part'].value);
 self.config.set('fl_bits', data['fl_bits'].value);
 self.config.set('input_device', data['input_device']);
 self.config.set('input_format', data['input_format'].value);
 self.config.set('output_device', data['output_device']);
 self.config.set('output_format', data['output_format'].value);



 self.rebuildBRUTEFIRAndRestartDaemon()
  .then(function(e) {
   self.commandRouter.pushToastMessage('success', "Configuration update", 'The configuration has been successfully updated');
   defer.resolve({});
  })
  .fail(function(e) {
   defer.reject(new Error());
  })


 return defer.promise;


};
ControllerBrutefir.prototype.rebuildBRUTEFIRAndRestartDaemon = function() {
 var self = this;
 var defer = libQ.defer();

 self.createBRUTEFIRFile()
  .then(function(e) {
   var edefer = libQ.defer();
   exec("killall brutefir.real", function(error, stdout, stderr) {
    edefer.resolve();
   });
   return edefer.promise;
  })
  .then(self.startBrutefirDaemon.bind(self))
  .then(function(e) {
   setTimeout(function() {
    self.logger.info("Connecting to daemon");
    self.brutefirDaemonConnect(defer);
   }, 5000);
  });

 return defer.promise;
},

/*ControllerBrutefir.prototype.getleftfilterfile = function()
{
    var self = this;
    var defer = libQ.defer();

    //var backgroundsArray = [];

    fs.readdir(leftfilterfilePath, function(err, files) {
        if (err) {
            console.log(err);
        }
        files.forEach(function(f) {

        var leftfilterfile_title = config.get('leftfilter_title');
        var leftfilterfile_path = config.get('leftfilter_path');
        var leftfilter = {"current":{"name":leftfilterfile_title,"path":leftfilterfile_path},"available":leftfilterfileArray};
        defer.resolve(backgrounds);

    });

    return defer.promise;
};
*/
ControllerBrutefir.prototype.loadI18NStrings = function (code) {
    this.logger.info('BRUTEFIR I18N LOAD FOR LOCALE '+code);

   this.i18nString=libFsExtra.readJsonSync(__dirname+'/i18n/strings_'+code+".json");
// this.i18nString=libFsExtra.readJsonSync('/data/pulgins/miscellanea/brutefir/i18n/strings_'+code+".json");
}


ControllerBrutefir.prototype.getI18NString = function (key) {
    return this.i18nString[key];
}



