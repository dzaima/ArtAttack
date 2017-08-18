// Usage: sandbox_utils.make(myFunction / myScriptName);
// myFunction executes inside the sandbox
// Returns a worker-like object which permits communication
// (addEventListener & sendMessage), and destruction (terminate)

define(['require', 'document', './EventObject', 'def:./EventObject', 'def:./sandbox_utils_inner'], (require, document, EventObject, EventObject_def, inner_def) => {
	'use strict';

	const STATE_LOADING = 0;
	const STATE_READY = 1;
	const STATE_KILLED = 2;

	const B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
	function makeNonce() {
		const buffer = new Uint8Array(16);
		crypto.getRandomValues(buffer);
		let r = '';
		for(let i = 0; i < buffer.length; ++ i) {
			r += B64[buffer[i] % 64];
		}
		return r;
	}

	class IFrame extends EventObject {
		constructor(postMessageFn, terminateFn) {
			super();
			this.postMessageFn = postMessageFn;
			this.terminateFn = terminateFn;
		}

		postMessage(message) {
			this.postMessageFn(message);
		}

		terminate() {
			this.terminateFn();
		}
	};

	function make(fn) {
		const iframe = document.createElement('iframe');
		let state = STATE_LOADING;
		const queueIn = [];
		let blockRequire = false;

		const postMessage = (message) => {
			if(state === STATE_READY) {
				iframe.contentWindow.postMessage(message, '*');
			} else {
				queueIn.push(message);
			}
		}

		const terminate = () => {
			state = STATE_KILLED;
			if(iframe && iframe.parentNode) {
				iframe.parentNode.removeChild(iframe);
				window.removeEventListener('message', messageListener);
			}
		}

		const o = new IFrame(postMessage, terminate);

		function handleScriptRequest(event) {
			const src = event.data.require_script_src;
			if(!src) {
				blockRequire = true;
				return;
			}
			if(blockRequire) {
				throw 'Blocked late sandbox require() call: ' + src;
			}
			require(['def:' + src], (def) => {
				postMessage({
					require_script_src: src,
					require_script_blob: def.code(),
				});
			});
		}

		function messageListener(event) {
			if(
				event.origin !== 'null' ||
				event.source !== iframe.contentWindow
			) {
				return;
			}
			if(event.data && event.data.require_script_src !== undefined) {
				return handleScriptRequest(event);
			}
			o.trigger('message', [event]);
		}

		let invocation;
		if(typeof fn === 'function') {
			invocation = fn.toString();
		} else {
			invocation = '() => require([' + JSON.stringify(fn) + '])';
		}

		// Thanks, https://stackoverflow.com/a/23522755/1180785
		const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

		// WORKAROUND: Safari fails to load blobs, so we give a special
		// permission to run unsafe eval code & arbitrary https code as a
		// workaround. For other browsers, we get to keep our stricter
		// permissions.
		const needUnsafe = safari;

		const src = (
			'const require_factory = ' + require_factory.toString() + ';\n' +
			'require_factory();\n' +
			EventObject_def.code() + '\n' +
			inner_def.code() + '\n' +
			'require([' + JSON.stringify(inner_def.src) + '])' +
			'.then(' + invocation + ');\n'
		);

		const nonce = makeNonce();

		const html = (
			'<html>\n' +
			'<head>\n' +
			'<meta charset="utf-8">\n' +
			'<meta http-equiv="content-security-policy" content="' +
			"script-src 'nonce-" + nonce + "'" + (needUnsafe ? " 'unsafe-eval' https:" : '') + " blob:;" +
			"style-src 'none';" +
			'">\n' +
			'<script nonce="' + nonce + '">' + src + '</script>\n' +
			'</head>\n' +
			'<body>\n' +
			'</body>\n' +
			'</html>\n'
		);

		iframe.setAttribute('sandbox', 'allow-scripts');
		iframe.style.display = 'none';
		iframe.setAttribute('src', URL.createObjectURL(new Blob(
			[html],
			{type: 'text/html'}
		)));

		iframe.addEventListener('error', (event) => {
			o.trigger('error', [event]);
		});

		iframe.addEventListener('load', () => {
			if(state === STATE_KILLED) {
				return;
			}
			state = STATE_READY;
			postMessage({sandbox_connected: true});
			queueIn.forEach(postMessage);
			queueIn.length = 0;
		}, {once: true});

		window.addEventListener('message', messageListener, {
			_no_sandbox_intercept: true,
		});

		document.body.appendChild(iframe);

		return o;
	}

	return {
		make,
	};
});
