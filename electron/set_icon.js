const { rcedit } = require('rcedit');
const path = require('path');

const exePath = path.join(__dirname, '../dist-electron/win-unpacked/Raiden.exe');
const iconPath = path.join(__dirname, '../logo.ico');

console.log('Setting icon for:', exePath);
console.log('Using icon:', iconPath);

async function setIcon() {
    try {
        await rcedit(exePath, {
            'icon': iconPath
        });
        console.log('✅ Icon set successfully!');
    } catch (err) {
        console.error('❌ Error setting icon:', err);
        process.exit(1);
    }
}

setIcon();
