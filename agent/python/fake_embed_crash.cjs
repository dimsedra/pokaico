// Exits with non-zero code without ever sending {"ready": true}
process.stderr.write("fake_embed_crash: simulating Python startup failure\n");
process.exit(1);
