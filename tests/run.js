const fs = require('fs');
const child_process = require('child_process');
const os = require('os');

// runs every test with the runtime running this script: node, deno or bun
const runtime = `"${process.execPath}"`;
const command = typeof Deno !== 'undefined' ? `${runtime} run -A` : typeof Bun !== 'undefined' ? runtime : `${runtime} --unhandled-rejections=strict`;

// Determine safe max concurrency based on available CPU cores
const concurrencyLimit = os.availableParallelism ? os.availableParallelism() : (os.cpus()?.length || 4);

(async () => {
    const testFiles = fs.readdirSync('./tests/').filter(file => file !== 'run.js' && file.slice(-3) === '.js');

    const runTest = (file) => {
        return new Promise((resolve) => {
            console.log(`[started] test ${file}`);
            const start = Date.now();
            const proc = child_process.exec(`${command} ./tests/${file}`);
            
            // Buffer outputs to prevent interleaving
            let stdoutData = '';
            let stderrData = '';
            
            proc.stdout.on('data', chunk => { stdoutData += chunk; });
            proc.stderr.on('data', chunk => { stderrData += chunk; });

            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, 60000);

            proc.on('exit', code => {
                clearTimeout(timeout);
                const duration = Date.now() - start;

                // Print the buffered output atomically once the test finishes
                if (stdoutData) process.stdout.write(stdoutData);
                if (stderrData) process.stderr.write(stderrData);

                if (code !== 0 || timedOut) {
                    if (timedOut) console.error(`script timeout: ${file}`);
                    console.error(`test ${file} failed in ${duration}ms`);
                    resolve(false);
                } else {
                    console.log(`test ${file} passed in ${duration}ms`);
                    resolve(true);
                }
            });
        });
    };

    // Concurrency pool runner to cap active tests at concurrencyLimit
    let index = 0;
    const results = [];
    async function worker() {
        while (index < testFiles.length) {
            const currentIndex = index++;
            const file = testFiles[currentIndex];
            results[currentIndex] = await runTest(file);
        }
    }

    console.log(`Running tests with a max concurrency of ${concurrencyLimit}...`);
    const workers = Array(Math.min(concurrencyLimit, testFiles.length)).fill(null).map(() => worker());
    await Promise.all(workers);

    if (results.every(Boolean)) {
        console.log('all tests passed');
    } else {
        console.error('some tests failed');
        process.exit(1);
    }
})();