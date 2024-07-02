require("url"); // for nextcloud
const https = require("node:https"); // for nextcloud
const fs = require("fs"); // for localdirectory

const NodeHelper = require("node_helper");

const _validFileExtensions = [".jpg", ".jpeg", ".bmp", ".gif", ".png", ".tiff"];

module.exports = NodeHelper.create({

    start: function() {
        var self = this;

        this.nextcloud = false;
        this.localdirectory = false;

        this.imageList = [];
		this.folderList = [];
        this.expressApp.get("/" + this.name + "/images/:randomImageName(*)", async function(request, response) {
            var imageBase64Encoded = await self.fetchEncodedImage(request.params.randomImageName);
            response.send(imageBase64Encoded);
        });
    },


    socketNotificationReceived: async function(notification, payload) {
        //console.log("["+ this.name + "] received a '" + notification + "' with payload: " + payload);
        if (notification === "SET_CONFIG") {
            this.config = payload;
            if (this.config.imageRepository === "nextcloud") {
                this.nextcloud = true;
            } else if (this.config.imageRepository === "localdirectory") {
                this.localdirectory = true;
            }
        }
        if (notification === "FETCH_IMAGE_LIST") {
			var folder = ""
            if (this.config.imageRepository === "nextcloud") {
                do {
					if (this.folderList.length > 0) {
						folder = this.folderList.pop();
					}
					[imageList, folderList] = await this.fetchNextcloudImageList(folder);
					console.log("imageList2 " + imageList);
					console.log("folderList2 " + folderList);
					this.imageList = this.imageList.concat(imageList);
					this.folderList = this.folderList.concat(folderList);
				} while(this.folderList.length > 0 && this.config.repositoryConfig.recursive)
				this.sendSocketNotification("IMAGE_LIST", this.imageList);
            }
            if (this.config.imageRepository === "localdirectory") {
                this.fetchLocalImageList();
            }
        }
    },

    fetchLocalImageDirectory: function(path) {
        var self = this;

        // Validate path
        if (!fs.existsSync(path)) {
            console.log("["+ self.name + "] ERROR - specified path does not exist: " + path);
            return false;
        }

        var fileList = fs.readdirSync(path, { withFileTypes: true });
        if (fileList.length > 0) {
            for (var f = 0; f < fileList.length; f++) {
                if (fileList[f].isFile()) {
                    //TODO: add mime type check here
                    self.imageList.push(path + "/" + fileList[f].name);
                }
                if ((self.config.repositoryConfig.recursive === true) && fileList[f].isDirectory()) {
                    self.fetchLocalImageDirectory(path + "/" + fileList[f].name);
                }
            }
            return;
        }
    },

    fetchLocalImageList: function() {
        var self = this;
        var path = self.config.repositoryConfig.path;

        self.imageList = [];
    	self.fetchLocalImageDirectory(path);

        self.sendSocketNotification("IMAGE_LIST", self.imageList);
        return false;
    },


    fetchNextcloudImageList: async function(folder="") {
        var self = this;
        var imageList = [];
        var imageListClean = [];
		var folderList = [];
        var path = self.config.repositoryConfig.path;

		console.log("executed nextcould fetch");

        var urlParts = new URL(path);
		if (folder != "") {
			console.log("reached this point");
			path = path.replace(urlParts.pathname, folder);
			urlParts = new URL(path);
		}
        const requestOptions = {
            method: "PROPFIND",
            headers: {
                "Authorization": "Basic " + new Buffer.from(this.config.repositoryConfig.username + ":" + this.config.repositoryConfig.password).toString("base64")
            }
        };
		console.log("path " + path);
		console.log("folder " + folder);
		console.log("url " + urlParts.host);
        return new Promise((resolve) => {
			https.get(path, requestOptions, function(response) {
				var body = "";
				console.log("sending request");
				response.on("data", function(data) {
					body += data;
				});
				response.on("end", function() {
					imageList = body.match(/href>\/[^<]+/g);
					imageList.shift(); // delete first array entry, because it contains the link to the current folder
					// if (imageList && imageList.length > 0) {
						imageList.forEach(function(item, index) {
							// remove clutter from the entry -> only save file name with path
							filePath = item.replace("href>", "");
							if (filePath.endsWith("/")) {
								folderList.push(filePath);
							} else {
								imageListClean.push(filePath);
							}
							//console.log("[" + self.name + "] Found entry: " + this.imageList[index]);
						});
						resolve([imageListClean, folderList]);
					// } else {
					// 	console.log("[" + this.name + "]: did not get any images from nextcloud url");
					// 	return false;
					// }
				});
			}).on("error", function(err) {
					console.log("[MMM-RandomPhoto] ERROR: " + err);
					resolve([[], []]);
				});
			});
    },

    fetchEncodedImage: async function(passedImageName) {
        var self = this;
        return new Promise(function(resolve, reject) {
            var fullImagePath = passedImageName;

            // Local files
            if (self.localdirectory) {
                var fileEncoded = "data:image/jpeg;base64," + fs.readFileSync(fullImagePath, { encoding: 'base64' });
                resolve(fileEncoded);
            }

            // Nextcloud
            else if (self.nextcloud) {
                const requestOptions = {
                    method: "GET",
                    headers: {
                        "Authorization": "Basic " + new Buffer.from(self.config.repositoryConfig.username + ":" + self.config.repositoryConfig.password).toString("base64")
                    }
                };
				urlParts = new URL(self.config.repositoryConfig.path)
				var path = self.config.repositoryConfig.path.replace(urlParts.pathname, fullImagePath);
				console.log("loading image: " + path);
                https.get(path, requestOptions, (response) => {
                    response.setEncoding('base64');
                    var fileEncoded = "data:" + response.headers["content-type"] + ";base64,";
                    response.on("data", (data) => { fileEncoded += data; });
                    response.on("end", () => {
                        resolve(fileEncoded);
                    });
                })
                .on("error", function(err) {
                    console.log("[" + this.name + "] ERROR: " + err);
                    return false;
                });
            }
        })


        /**
        var getMimeObject = spawn("file", ["-b", "--mime-type", "-0", "-0", file]);
        getMimeObject.stdout.on('data', (data) => {
            var mimeType = data.toString().replace("\0", "");
            //console.log("mime type is: '" + mimeType + "'");
            var fileEncoded = "data:" + mimeType + ";base64,";
            fileEncoded += fs.readFileSync(file, { encoding: 'base64' });
            //console.log("base64:");
            console.log("<img src='" + fileEncoded + "' />");
            //return fileEncoded;
        });
        **/
    },

	hasExtension: function(inputID, exts) {
		var fileName = document.getElementById(inputID).value;
		return (new RegExp('(' + exts.join('|').replace(/\./g, '\\.') + ')$')).test(fileName);
	},

});
