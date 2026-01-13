1. Setup database
```sh
docker run -d --name=token_terminal -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:16
docker exec -it token_terminal psql -U postgres -c 'CREATE DATABASE token_terminal'
```

2. Migrate database
```sh
npm run migrate
```
