# EmojiBot
A bot for CollabVM which can send Emojis into the chat using XSS.

Here's how to use:


First, clone the repository.
Then, go to the directory and run yarn.
After that, add stuff idk what this is just do this:

yarn add ws node-fetch

yarn add -D @types/node @types/ws @types/node-fetch

Then compile using yarn build.
Then copy config.example.json to config.json and fill out everything. Move emojilist.json to a web server and add your emojis.

You can run the Bot with yarn server or directly with node dist/index.js.
There is a premade SystemD service in emojibot.example.service. You only need to modify the workingDirectory.
