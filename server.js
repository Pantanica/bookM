import express from "express";
import bodyParser from "body-parser";
import cors from 'cors';
import pg from "pg";
import sha1 from 'sha1';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';

const app = express();
const port = 3000;

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "BookmatchProd",
  password: "123",
  port: 5432,
});


db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors());
app.use(bodyParser.json());


function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

//Token id user middleware
function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token is required" });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    try {
        const decoded = jwt.verify(token, "your-secret-key");
        req.user = decoded;
        
        next();
    } catch (error) {
        return res.status(403).json({ error: "Invalid token" });
    }
}


//Multer middleware 

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); 
    },
    filename: function (req, file, cb) {
        
        const ext = file.originalname.split('.').pop();
        const randomNumber = getRandomInt(100000);

        const newFilename = file.originalname.replace('.' + ext, `_${randomNumber}.${ext}`);
        //console.log(newFilename);
        cb(null, newFilename); 
    }
});
// Configure multer upload middleware
const upload = multer({ storage: storage });

app.post('/api/register', upload.single('image'), async (req, res) => {
    // Extract form data from the request body
    const { nombres, apellidos, codigo, correo, password, repetirPassword } = req.body;
    console.log(req.body);
    try {
        // Perform validation checks here if needed
        const emailValidationQuery = `SELECT correo FROM usuario WHERE correo = $1`;
        const checkEmailValidation = await db.query(emailValidationQuery, [correo]);

        console.log(checkEmailValidation);
        const checkEmailDomain = "@alumnos.udg.mx";

        if (!req.file) {
            // Handle the case where no file was uploaded
            return res.status(400).json({ error: 'No se subio la credencial' });
        }
        const image = req.file; // Access the uploaded file
        const imageName = image.filename; // Store the filename
        console.log(imageName);
        console.log(correo);
        if (correo.includes(checkEmailDomain)){

            if(checkEmailValidation.rowCount > 0){
                res.setHeader('Content-Type', 'application/json');
                res.status(400).json({ error: 'El correo ya existe!!' });
                console.log(checkEmailValidation.rowCount);
            }else{
                if(password !== repetirPassword){
                    res.setHeader('Content-Type', 'application/json');
                    res.status(400).json({ error: 'Las contraseñas no coinciden' });
                    console.log("passwords dont match!");
                }else{
                    try{
                        // Insert the user data into the database
                        const hashedPassword = sha1(password);
                        console.log(hashedPassword);
                        const insertQuery = `
                        INSERT INTO usuario (nombres, apellidos, correo, password, is_verified, codigo, is_admin, credencial)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        `;
                        await db.query(insertQuery, [nombres, apellidos, correo, hashedPassword, false, codigo, false, imageName]);
                        try{
                            const idUsuarioQuery = `SELECT id FROM usuario WHERE correo = $1 AND password = $2`;
                            const idResponse = await db.query(idUsuarioQuery, [correo, hashedPassword]);
                            
                            console.log(idResponse.rows[0].id);
                            res.status(200).json(idResponse.rows[0].id);
                        }catch(err){
                            res.status(500).json({err: "No se pudo registrar el usuario"});
                        }
                        
                    }catch(error){
                        console.error('Error registering user:', error);
                        res.setHeader('Content-Type', 'application/json');
                        res.status(500).json({ error: 'No se pudo registrar al usuario!' });
                    }
                }
                }
                
        }else{
            res.status(400).json({ error: 'El dominio del correo no es valido!!' });
        }
        

    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Failed to register user' });
    }
});


app.post('/api/login', async (req, res) => {
    const { correo, password } = req.body;
    console.log(req.body);
    try {
        const checkIfExists = `SELECT * FROM usuario WHERE correo = $1`;
        const checkIfExistsResponse = await db.query(checkIfExists,[correo]);
        if (checkIfExistsResponse.rowCount==0) {
            res.status(200).json({message:"La cuenta no existe", icon:"error"})


        } else {
            const hashedPassword = sha1(password);
            const credentialsValidationQuery = `SELECT id, correo, password FROM usuario WHERE correo = $1 AND password = $2`;
            const checkCredentialsValidation = await db.query(credentialsValidationQuery, [correo, hashedPassword]);
        
            const tokenIdQuery = `SELECT id FROM usuario WHERE correo = $1`;
            const resTokenIdQuery =  await  db.query(tokenIdQuery, [correo]);
            
            const tokenTypeAccount = `SELECT is_admin, is_verified FROM usuario where correo = $1`;
            const resTokenTypeAccount =  await db.query(tokenTypeAccount, [correo]); 

            console.log(resTokenTypeAccount.rows[0].is_admin);
            console.log("is verified "+resTokenTypeAccount.rows[0].is_verified);

            if(checkCredentialsValidation.rowCount === 1 && resTokenIdQuery.rowCount === 1){
                
                try {
                    const token = jwt.sign({ userId: resTokenIdQuery.rows[0].id }, 'your-secret-key');
                    //const tokenTypeAccount = jwt.sign({typeAccount: resTokenTypeAccount.rows[0].typeAccount}, 'secret-key');
                    const tokenTypeAccount = resTokenTypeAccount.rows[0].is_admin;
                    const isVerified = resTokenTypeAccount.rows[0].is_verified;
                    res.status(200).json({ message: 'Inicio de sesion exitoso', icon:'success', token, tokenTypeAccount, isVerified });
                } catch (error) {
                    console.error('Error generating token or setting user ID:', error);
                }
                
                
            }else{
                res.setHeader('Content-Type', 'application/json');
                res.status(400).json({ error: 'Incorrect password or email' });
            }
        }
        
            
    } catch (error) {
        res.status(500).json({ error: 'Failed to login user' });
    }
});



app.post('/api/addBook', verifyToken, upload.single('image'), async (req, res) => {
    try {
        const userId = req.user.userId;
        const { titulo, autor, isbn, descripcion, review } = req.body;  // Agregado: extraer 'review' del cuerpo
        const image = req.file; // Access the uploaded file
        const imageName = image.filename; // Store the filename
        console.log(imageName);
        const tags = JSON.parse(req.body.tags);
        console.log("SelectedTags");
        console.log(tags);

        // Insert book data into the database, including the image filename or URL
        const insertQuery = `
            INSERT INTO libro (titulo, autor, isbn, descripcion, idusuario, coverimage, is_available)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_libro`;
        const result = await db.query(insertQuery, [titulo, autor, isbn, descripcion, userId, imageName, true]); // Assuming filename is used to store the image
        console.log(result.rows);

        const bookId = result.rows[0].id_libro;
        console.log(bookId);

        // Insert review into the review table
        if (review) {
            const insertReviewQuery = `
                INSERT INTO review (id_libro, opinion)
                VALUES ($1, $2)`;
            await db.query(insertReviewQuery, [bookId, review]);
        }

        // Insert tags into libro_tags table
        try {
            for (const tagId of tags) {
                const insertTagQuery = `
                    INSERT INTO libro_tags (libroid, tagid)
                    VALUES ($1, $2)`;
                await db.query(insertTagQuery, [bookId, tagId]);
            }

        } catch (error) {
            return res.status(500).json({ error: "No se pudieron agregar los tags" });
        }

        // Respond with success message
        res.status(200).json({ message: 'Book added successfully' });
    } catch (error) {
        console.error('Error adding book:', error);
        res.status(500).json({ error: 'Failed to add book' });
    }
});


app.get('/api/renderBooks', verifyToken, async (req, res) => {
    const userId = req.user.userId;
    console.log("User");
    console.log(userId);
    try {
        const displayBooksQuery = `SELECT 
        libro.id_libro, 
        libro.titulo, 
        libro.autor, 
        libro.isbn, 
        libro.descripcion, 
        libro.coverimage, 
        usuario.nombres, 
        usuario.id,
        ARRAY_AGG(tags.tagname) AS tagsArray
    FROM 
        libro 
    INNER JOIN 
        usuario ON usuario.id = libro.idusuario 
    LEFT JOIN 
        libro_tags ON libro_tags.libroid = libro.id_libro
    LEFT JOIN 
        tags ON tags.idtag = libro_tags.tagid
    WHERE 
        usuario.id = $1
    GROUP BY 
        libro.id_libro, 
        libro.titulo, 
        libro.autor, 
        libro.isbn, 
        libro.descripcion, 
        libro.coverimage, 
        usuario.nombres, 
        usuario.id;
    `;
        const displayBooks = await db.query(displayBooksQuery, [userId]);
        console.log(displayBooks.rows);
        res.status(200).json(displayBooks.rows);

    } catch (error) {
        res.status(500).json({ error: "Failed to load books" });
    }
});




app.delete('/api/deleteBook/:id', verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const bookId = req.params.id;

    console.log("user id: " + userId);
    console.log("book id " + bookId);

    try {
        await db.query('BEGIN'); // Start transaction

        // Delete tags associated with the book
        const deleteTagsQuery = `DELETE FROM libro_tags WHERE libroid = $1`;
        await db.query(deleteTagsQuery, [bookId]);

        // Delete book from waiting list
        const deleteBookFromWL = `DELETE FROM waiting_list WHERE book_id=$1`;
        await db.query(deleteBookFromWL, [bookId]);

        const deleteReview = 'DELETE FROM review WHERE id_libro=$1';
        await db.query(deleteReview, [bookId]);

        // Get loan ID for the book
        const getLoanId = `SELECT loan_id FROM loan_book WHERE book_id = $1`;
        const loanIdResponse = await db.query(getLoanId, [bookId]);
        if (loanIdResponse.rows.length > 0) {
            const loan_id = loanIdResponse.rows[0].loan_id;

            // Delete messages associated with the loan
            const deleteBookChat = `DELETE FROM messages WHERE loan_id = $1`;
            await db.query(deleteBookChat, [loan_id]);

            // Delete the loan record
            const deleteLoanBook = `DELETE FROM loan_book WHERE book_id = $1`;
            await db.query(deleteLoanBook, [bookId]);
        }

        // Delete the book
        const deleteBookQuery = `DELETE FROM libro WHERE id_libro = $1 AND idusuario = $2`;
        const deleteBookResult = await db.query(deleteBookQuery, [bookId, userId]);

        // Check if the book was successfully deleted
        if (deleteBookResult.rowCount === 0) {
            throw new Error('El libro no fue encontrado o no pertenece al usuario.');
        }

        await db.query('COMMIT'); // Commit transaction
        res.status(200).json({ message: "El libro y sus datos asociados se borraron correctamente." });

    } catch (error) {
        await db.query('ROLLBACK'); // Rollback transaction in case of error
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});


app.post('/api/verifyUser/:id', async (req, res)=>{
    const idUser =  req.params.id;
    console.log(idUser);
    try{
        const validateUserQuery = `UPDATE usuario SET is_verified = true WHERE id = $1`;
        await db.query(validateUserQuery, [idUser]);
        res.status(200).json({message: "Usuario validado con exito"});
    }catch(err){
        res.status(500).json({err: 'no se pudo validar el usuario'})
    }
})

app.delete('/api/verifyUser/deleteUser/:id', async (req, res)=>{
    const idUser =  req.params.id;
    console.log(idUser);
    try{
        const getProfileId = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const idResponse = await db.query(getProfileId, [idUser]);
        const profileId = idResponse.rows[0].id;
        console.log(profileId);

        try{
            const deleteTags = `DELETE FROM user_tags WHERE user_id = $1`;
            await db.query(deleteTags, [profileId]);
            try{
                const deleteUserProfile = `DELETE FROM perfil_usuario WHERE id = $1`;
                await db.query(deleteUserProfile, [profileId]);
                try{
                    const deleteUserQuery = `DELETE FROM usuario where id = $1`;
                    await db.query(deleteUserQuery, [idUser]);
                    res.status(200).json({message: "Usuario eliminado con exito"});

                }catch(err){
                    res.status.json({err: "No se pudo borrar el usuario!"})
                }
            }catch(err){
                res.status.json({err: "No se pudo borrar el perfil"})
            }
        }catch(err){

            res.status(500).json({err: "No se pudieron borrar los tags!"});
        }
        
    }catch(err){
        res.status(500).json({err: "No se pudo obtener el id del perfil del usuario"})
    }
})


app.post('/api/editBook/:bookId', verifyToken, upload.single('image'), async (req, res) => {
    try {
        const idUsuario = req.user.userId;
        const idLibro = req.params.bookId;
        const { titulo, autor, isbn, descripcion, review } = req.body;
        const image = req.file; // Access the uploaded file
        const imageName = image ? image.filename : null; // Store the filename if an image is uploaded
        const tags = JSON.parse(req.body.tags || '[]'); // Default to empty array if tags are undefined

        // Update book data
        const updateBookQuery = `
            UPDATE libro 
            SET titulo = $1, autor = $2, isbn = $3, descripcion = $4, coverimage= $5 
            WHERE id_libro = $6 AND idusuario = $7`;
        
        await db.query(updateBookQuery, [titulo, autor, isbn, descripcion, imageName, idLibro, idUsuario]);

        // Insert or update review
        if (review) {
            const insertReviewQuery = `
            INSERT INTO review (id_libro, opinion) 
            VALUES ($1, $2) 
            ON CONFLICT (id_libro) DO UPDATE SET opinion = excluded.opinion`;
            await db.query(insertReviewQuery, [idLibro, review]);
        }

        // Update tags
        try {
            const deleteTagsQuery = `DELETE FROM libro_tags WHERE libroid = $1`;
            await db.query(deleteTagsQuery, [idLibro]);

            for (const tagId of tags) {
                const insertTagQuery = `INSERT INTO libro_tags (libroid, tagid) VALUES ($1, $2)`;
                await db.query(insertTagQuery, [idLibro, tagId]);
            }

            res.status(200).json({ message: "Libro actualizado" });
        } catch (error) {
            console.error("Error updating tags:", error); // Log the error
            res.status(500).json({ error: "No se pudieron insertar nuevos tags!" });
        }

    } catch (error) {
        console.error("Error during book update:", error); // Log the error
        res.status(500).json({ error: "Book update failed" });
    }
});


app.get('/api/getUsers', async (req, res)=>{
    try{
        const getUsersQuery = `SELECT id, nombres, apellidos, correo, codigo, credencial FROM usuario where is_verified = false`
        const responseGetUsers = await db.query(getUsersQuery);

        console.log(responseGetUsers.rows);
        const usersInfo = responseGetUsers.rows;

        res.status(200).json({message: "Query succesful", usersInfo });
    }catch(err){

        res.status(500).json({error:"Cannot get users"})
    }


});

app.get('/api/tags', async(req, res) =>{
    try{
        const getTagsQuery = `SELECT * FROM tags`;
        const responseTagQuery = await db.query(getTagsQuery);
        
        const tagsInfo = responseTagQuery.rows;
        console.log(tagsInfo);
        res.status(200).json({message: "Tags obtenidos correctamente", tagsInfo})

    }catch(err){
        res.status(500).json({err: "No se pudieron obtener los tags!"});
    }



});

app.post('/api/customizeProfile/:idUsuario', upload.single('image'), async (req, res)=>{
    const idUsuario = req.params.idUsuario;
    console.log(idUsuario);
    const tags = JSON.parse(req.body.tags);
    
    const profilePicture =  req.file;
    const profilePicName =  profilePicture.filename;
    const idUsuarioInt = Number(idUsuario);
    try{
        console.log(profilePicName);
        const profilePicQuery = `INSERT INTO perfil_usuario (user_id, profile_pic)
                                VALUES ($1, $2)`;
        console.log("Es tipo: "+typeof(idUsuario));
        db.query(profilePicQuery, [idUsuarioInt, profilePicName]);

        const getIdQuery =  `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const getIdQueryResponse = await db.query(getIdQuery, [idUsuarioInt]);

       
        const idProfileUser = getIdQueryResponse.rows[0].id;
        console.log("Hola: " + idProfileUser);
        try{
            
            console.log(tags.length);
            console.log(Array.isArray(tags));
            console.log(tags);
            for (let i = 0; i<tags.length; i++){
                let tagId = tags[i];
                const insertTagsQuery = `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2)`;
                await db.query(insertTagsQuery, [idProfileUser, tagId]);
                
            }
            
            res.status(200).json({message: "Todo piola"});
       }catch(err){

            res.status(200).json({err: "No se pudieron insertar los tags"});
       }

    }catch(err){

        res.status(500).json({err: "No se pudo insertar foto de perfill"});
    }
    

});

app.get("/api/getProfilePic", verifyToken, async (req, res)=>{
    const userId =  req.user.userId;
    console.log(userId);
    try{
        const getProfilePicQuery = `SELECT profile_pic FROM perfil_usuario where user_id =$1`;
        const responseProfilePic = await db.query(getProfilePicQuery, [userId]);
        const profile_pic = responseProfilePic.rows[0].profile_pic;
        console.log(profile_pic);

        res.status(200).json({profile_pic});


    }catch(err){


        res.status(500).json({erro:"No se pudo obetener la foto de perfil!"});
    }    
});

app.get("/api/getName", verifyToken, async (req, res)=>{
    
    
    try{
        const userId =  req.user.userId;
        console.log("usuario id " +userId);

        const getNameQuery = `SELECT nombres, apellidos FROM usuario WHERE id = $1`;

        const nameResponse =  await db.query(getNameQuery, [userId]);
        const fullName = nameResponse.rows[0].nombres + " "+ nameResponse.rows[0].apellidos;
        console.log(fullName);

        res.status(200).json({fullName});

    }catch(err){

        res.status(500).json({err: "No se pudo obtener el nombre"})
    }


})


app.post('/api/profile/updatePic', verifyToken, upload.single('image'), async (req, res)=>{

    const userId = req.user.userId;

    console.log(userId);
    const profilePicture =  req.file;
    
    const profilePicName =  profilePicture.filename;
    console.log(profilePicName);

    try{
        const getIdProfileQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const idProfileResponse =  await db.query(getIdProfileQuery, [userId]);
        
        const profileId = idProfileResponse.rows[0].id;
        console.log(profileId);
        try{
            const updatePicQuery = `UPDATE perfil_usuario SET profile_pic = $1 WHERE id = $2`;
            await db.query(updatePicQuery, [profilePicName, profileId]);
            res.status(200).json({message: "Foto de perfil actualizada con exito"});
        }catch(err){
            res.status.json({err: "No se pudo actualizar la foto de perfil"});
        }
    }catch(err){
        res.status(500).json({err: "No se pudo obtener el ID del perfil"});
        
    }

})

app.get('/api/getTags', verifyToken, async (req, res)=>{

    const userId = req.user.userId;
    console.log(userId);
    try{
        const getIdProfileQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const idProfileResponse =  await db.query(getIdProfileQuery, [userId]);
        
        const profileId = idProfileResponse.rows[0].id;
        console.log(profileId);
        try{
            const getTagsQuery = `SELECT tags.tagname FROM tags INNER JOIN user_tags ON tags.idtag = user_tags.tag_id WHERE user_tags.user_id =$1`;
            const tagResponse = await db.query(getTagsQuery, [profileId]);
            const sentTags = tagResponse.rows;
            console.log(sentTags);
            res.status(200).json({message: "Foto de perfil actualizada con exito", sentTags});
        }catch(err){
            res.status.json({err: "No se pudo actualizar la foto de perfil"});
        }
    }catch(err){
        res.status(500).json({err: "No se pudo obtener el ID del perfil"});
        
    }
})

app.post('/api/customizeTags/', verifyToken, async (req, res) => {
    const userId = req.user.userId;
    console.log(userId);
    
    const tags = req.body; 
    console.log("los tags");
    console.log(tags);
    try {
        const getIdProfileQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const idProfileResponse =  await db.query(getIdProfileQuery, [userId]);
        const profileId = idProfileResponse.rows[0].id;
        console.log("id perfil " + profileId);

        try{

            try{
                const deleteTagsQuery = `DELETE FROM user_tags WHERE user_id = $1`;
                await db.query(deleteTagsQuery, [profileId]);

                try {
                    console.log(tags.length);
                    console.log(Array.isArray(tags));
                    console.log(tags);
                    for (let i = 0; i<tags.length; i++){
                        let tagId = tags[i];
                        const insertTagsQuery = `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2)`;
                        await db.query(insertTagsQuery, [profileId, tagId]);
                
                    }
            
                    res.status(200).json({message: "Todo piola"});

                } catch (error) {
                    res.status(500).json({error: "No "})
                }

                
            }catch(err){
                res.status(500).json({err: 'No se pudieron borrar los tags'});
            }
            


        }catch(err){
            res.status(500).json({ err: 'No se pudieron optimizar los tags' });
        }
    } catch (err) {
        
        res.status(500).json({err: "No se pudo obtener el ID del perfil"});
    }
});


app.get('/api/feedBooks', verifyToken, async (req, res) => {
    const userId = req.user.userId;

    console.log("El id del usuario: " + userId);

    try {
        const getIdProfileQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const idProfileResponse = await db.query(getIdProfileQuery, [userId]);
        const profileId = idProfileResponse.rows[0].id;
        console.log("id perfil " + profileId);

        try {
            const matchingBooksQuery = `
           SELECT 
    libro.id_libro, 
    libro.titulo, 
    libro.autor, 
    libro.isbn, 
    libro.descripcion, 
    libro.coverimage, 
    usuario.nombres, 
    usuario.id,
    ARRAY_AGG(DISTINCT tags.tagname) AS tagsArray,  -- Eliminar duplicados de etiquetas
    COALESCE(ARRAY_AGG(DISTINCT review.opinion) FILTER (WHERE review.id_libro IS NOT NULL), '{}') AS reviews -- Eliminar duplicados de reseñas
FROM 
    libro 
INNER JOIN 
    usuario ON usuario.id = libro.idusuario 
LEFT JOIN 
    libro_tags ON libro_tags.libroid = libro.id_libro
LEFT JOIN 
    tags ON tags.idtag = libro_tags.tagid
LEFT JOIN 
    review ON review.id_libro = libro.id_libro
WHERE 
    usuario.id != $1 
    AND EXISTS (
        SELECT 1 
        FROM 
            user_tags 
        WHERE 
            user_tags.user_id = $2 
            AND user_tags.tag_id = tags.idtag
    )
GROUP BY 
    libro.id_libro, 
    libro.titulo, 
    libro.autor, 
    libro.isbn, 
    libro.descripcion, 
    libro.coverimage, 
    usuario.nombres, 
    usuario.id;
`;

            const matchingBooksResponse = await db.query(matchingBooksQuery, [userId, profileId]);

            const booksJSON = matchingBooksResponse.rows; 
            console.log(booksJSON);

            res.status(200).json(booksJSON); 
        } catch (error) {
            res.status(500).json({ error: "No se pudieron obtener los libros" });
        }
    } catch (error) {
        res.status(500).json({ error: "No se pudieron cargar los libros" });
    }
});




app.get("/api/getUserName/:userId", async (req, res)=>{
    
    const userId =  req.params.userId;
    console.log("usuario id " +userId);
    
    try{

        const getNameQuery = `SELECT nombres, apellidos FROM usuario WHERE id = $1`;

        const nameResponse =  await db.query(getNameQuery, [userId]);
        const fullName = nameResponse.rows[0].nombres + " "+ nameResponse.rows[0].apellidos;
        console.log(fullName);

        res.status(200).json({fullName});

    }catch(err){

        res.status(500).json({err: "No se pudo obtener el nombre"})
    }


})

app.get("/api/getUserProfilePic/:userId", async (req, res)=>{
    const userId =  req.params.userId;
    console.log("fotico " +userId);
    try{
        const getProfilePicQuery = `SELECT profile_pic FROM perfil_usuario where user_id =$1`;
        const responseProfilePic = await db.query(getProfilePicQuery, [userId]);
        const profile_pic = responseProfilePic.rows[0].profile_pic;
        console.log(profile_pic);

        res.status(200).json({profile_pic});


    }catch(err){


        res.status(500).json({err:"No se pudo obetener la foto de perfil!"});
    }    
});

app.get('/api/renderUserBooks/:token',  async (req, res) => {
    const userId = req.params.token;
    console.log("User");
    console.log(userId);
    try {
        const displayBooksQuery = `SELECT 
        libro.id_libro, 
        libro.titulo, 
        libro.autor, 
        libro.isbn, 
        libro.descripcion, 
        libro.coverimage, 
        usuario.nombres, 
        usuario.id,
        ARRAY_AGG(tags.tagname) AS tagsArray
    FROM 
        libro 
    INNER JOIN 
        usuario ON usuario.id = libro.idusuario 
    LEFT JOIN 
        libro_tags ON libro_tags.libroid = libro.id_libro
    LEFT JOIN 
        tags ON tags.idtag = libro_tags.tagid
    WHERE 
        usuario.id = $1
    GROUP BY 
        libro.id_libro, 
        libro.titulo, 
        libro.autor, 
        libro.isbn, 
        libro.descripcion, 
        libro.coverimage, 
        usuario.nombres, 
        usuario.id;
    `;
        const displayBooks = await db.query(displayBooksQuery, [userId]);
        console.log(displayBooks.rows);
        res.status(200).json(displayBooks.rows);

    } catch (error) {
        res.status(500).json({ error: "Failed to load books" });
    }
});


app.post('/api/reportUser/:userReportedId', upload.single('image'), async (req, res)=>{

    const reportedUserId = req.params.userReportedId;
    const evidence =  req.file;
    const evidenceFile =  evidence.filename;
    const motivo = req.body.motivo;

    try {
        const reportQuery = `INSERT INTO reportes (motivo, evidencia, id_usuario) VALUES ($1, $2, $3)`;
        await db.query(reportQuery, [motivo, evidenceFile, reportedUserId]);
        res.status(200).json({message: "El reporte se realizo con exito!"});
    } catch (error) {
        res.status(500).json({error: "No se pudo realizar el reporte!"})
    }


})

app.get('/api/renderReports', async (req, res)=>{
    try {
        const fetchReportQuery = `SELECT perfil_usuario.profile_pic, reportes.motivo, reportes.id_reporte, reportes.evidencia, reportes.id_usuario, usuario.nombres, usuario.apellidos, usuario.correo, usuario.codigo 
        FROM reportes 
        INNER JOIN perfil_usuario ON reportes.id_usuario = perfil_usuario.user_id 
        INNER JOIN usuario ON reportes.id_usuario = usuario.id;`;

        const responseReportQuery = await db.query(fetchReportQuery);

        console.log(responseReportQuery.rows);

        const reportsInfo = responseReportQuery.rows;
        res.status(200).json({message: "Todo bien", reportsInfo})
        
    } catch (error) {
        res.status(500).json({error: "No se pudieron cargar los reportes"})
    }


})

app.get('/api/getUserTags/:userId', async (req, res)=>{
    const userId = req.params.userId;

    console.log(userId);
    try {
        const profileIdQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const profileIdResponse = await db.query(profileIdQuery, [userId]);

        console.log(profileIdResponse.rows);
        const profileId = profileIdResponse.rows[0];
        const profileUserId = profileId.id;
        console.log("Perfil id "+ profileUserId);


        try {
            const getUserTagsQuery = `SELECT tags.tagname FROM tags INNER JOIN user_tags ON tags.idtag = user_tags.tag_id WHERE user_tags.user_id =$1`;
            const getUserTags =  await db.query(getUserTagsQuery, [profileUserId]);

           
            const userTagsToSend = getUserTags.rows;
            console.log(userTagsToSend);

            res.status(200).json(userTagsToSend);
            
        } catch (error) {
            res.status(500).json({error:"No se pudieron obtener los tags"})
        }
    } catch (error) {
        res.status(500).json({error: "No se pudo obtener el id del perfil del usuario"})
    }
});


app.post('/api/loanRequest/:idLibro', verifyToken, async (req, res) => {
    const idLibro = req.params.idLibro;
    const idPropietario = req.query.idUsuario;
    const idSolicitante = req.user.userId;

    console.log(idLibro, idPropietario, idSolicitante);

    try {
        const isAvalibaleCheckQuery = `SELECT is_available FROM libro WHERE id_libro = $1`;
        const isAvaliableResponse = await db.query(isAvalibaleCheckQuery, [idLibro]);

        if (isAvaliableResponse.rows[0].is_available === true) {
            const currentDate = new Date();
            const formattedDate = currentDate.toISOString().split('T')[0];

            const insertLoanQuery = `
                INSERT INTO loan_book (user_id, book_id, loan_date, status, id_propietario) 
                VALUES ($1, $2, $3, $4, $5)`;
            await db.query(insertLoanQuery, [idSolicitante, idLibro, formattedDate, 'waiting_confirmation', idPropietario]);

            const updateBookAvalabilityQuery = `UPDATE libro SET is_available = $1 WHERE id_libro = $2`;
            await db.query(updateBookAvalabilityQuery, [false, idLibro]);

            res.status(200).json({ message: "Intercambio pendiente de confirmación :)" });
        } else {
            res.status(400).json({ message: "El libro no está disponible para préstamo." });
        }
    } catch (error) {
        console.error("Error en la solicitud de préstamo:", error);
        res.status(500).json({ error: "No se pudo solicitar el préstamo" });
    }
});


app.get('/api/feedBooksSearch/:search', verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const search = req.params.search;

    try {
        const getIdProfileQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
        const idProfileResponse = await db.query(getIdProfileQuery, [userId]);
        const profileId = idProfileResponse.rows[0].id;

        const matchingBooksQuery = `
            SELECT 
                libro.id_libro, 
                libro.titulo, 
                libro.autor, 
                libro.isbn, 
                libro.descripcion, 
                libro.coverimage, 
                usuario.nombres, 
                usuario.id,
                ARRAY_AGG(DISTINCT tags.tagname) AS tagsArray,
                COALESCE(ARRAY_AGG(DISTINCT review.opinion) FILTER (WHERE review.id_libro IS NOT NULL), '{}') AS reviews
            FROM 
                libro 
            INNER JOIN 
                usuario ON usuario.id = libro.idusuario 
            LEFT JOIN 
                libro_tags ON libro_tags.libroid = libro.id_libro
            LEFT JOIN 
                tags ON tags.idtag = libro_tags.tagid
            LEFT JOIN 
                review ON review.id_libro = libro.id_libro
            WHERE 
                libro.titulo ILIKE '%' || $1 || '%'
                AND usuario.id != $2 
            GROUP BY 
                libro.id_libro, 
                libro.titulo, 
                libro.autor, 
                libro.isbn, 
                libro.descripcion, 
                libro.coverimage, 
                usuario.nombres, 
                usuario.id;
        `;

        const matchingBooksResponse = await db.query(matchingBooksQuery, [search, userId]);
        const booksJSON = matchingBooksResponse.rows;

        const rowCount = matchingBooksResponse.rowCount;

        res.status(200).json({ rowCount, booksJSON });
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).json({ error: "No se pudieron obtener los libros" });
    }
});




app.post('/api/addStrike', async (req, res) => {
    const { idReporte, idUserReportado } = req.body;

    console.log(idReporte, idUserReportado);

    try {
        await db.query('BEGIN');

        // Obtener strikes actuales
        const getCurrentStrikesQuery = `SELECT strikes FROM usuario WHERE id = $1`;
        const getCurrentStrikes = await db.query(getCurrentStrikesQuery, [idUserReportado]);

        if (getCurrentStrikes.rows.length === 0) {
            throw new Error("Usuario no encontrado");
        }

        console.log("Strikes actuales: ", getCurrentStrikes.rows[0].strikes);

        let updateStrikes = getCurrentStrikes.rows[0].strikes + 1;
        console.log(updateStrikes);

        if (updateStrikes > 2) {
            // Check if the user was on a loan
            const checkLoanQuery = `SELECT * FROM loan_book WHERE user_id = $1`;
            const checkLoanResult = await db.query(checkLoanQuery, [idUserReportado]);
            console.log("Check loan result: ", checkLoanResult.rows);

            if (checkLoanResult.rows.length > 0) {
                // The user was on a loan, check for the same book in the waiting list
                const loanedBooks = checkLoanResult.rows.map(row => row.book_id);
                console.log("Loaned books: ", loanedBooks);

                if (loanedBooks.length > 0) {
                    const checkWaitingListQuery = `
                        SELECT waiting_id, turno, user_id, book_id, id_propietario
                        FROM waiting_list 
                        WHERE book_id = ANY($1::int[])
                    `;
                    const checkWaitingListResult = await db.query(checkWaitingListQuery, [loanedBooks]);
                    console.log("Check waiting list result: ", checkWaitingListResult.rows);

                    if (checkWaitingListResult.rows.length > 0) {
                        for (const waitingBook of checkWaitingListResult.rows) {
                            // Ensure the structure of the waitingBook is as expected
                            console.log(`Processing waiting book: ${JSON.stringify(waitingBook)}`);

                            // Subtract 1 from the turno column
                            const updatedTurn = waitingBook.turno - 1;
                            console.log(`Updating turno for waiting book ID ${waitingBook.waiting_id} to ${updatedTurn}`);

                            if (!isNaN(updatedTurn) && updatedTurn === 0) {
                                // If turno becomes 0, insert into the loan table with current date
                                const loanDate = new Date(); // current date and time
                                await db.query(`INSERT INTO loan_book (user_id, book_id, loan_date, id_propietario, status) VALUES ($1, $2, $3, $4, $5)`, 
                                    [waitingBook.user_id, waitingBook.book_id, loanDate, waitingBook.id_propietario, 'waiting_confirmation']);
                                // Remove the waiting list entry
                                await db.query(`DELETE FROM waiting_list WHERE waiting_id = $1`, [waitingBook.waiting_id]);
                            } else if (!isNaN(updatedTurn)) {
                                // Update the turno column if the updatedTurn is a valid number
                                await db.query(`UPDATE waiting_list SET turno = $1 WHERE waiting_id = $2`, [updatedTurn, waitingBook.waiting_id]);
                            }
                        }
                    } else {
                        // If no entries in the waiting list, set the book as available
                        await db.query(`UPDATE libro SET is_available = true WHERE id_libro = ANY($1::int[])`, [loanedBooks]);
                    }
                }
            }

            // Eliminar datos relacionados en otras tablas dependientes de perfil_usuario primero
            const perfilUsuarioQuery = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
            const perfilUsuarioResult = await db.query(perfilUsuarioQuery, [idUserReportado]);
            console.log("Perfil usuario result: ", perfilUsuarioResult.rows);

            if (perfilUsuarioResult.rows.length > 0) {
                const perfilUsuarioId = perfilUsuarioResult.rows[0].id;
                await db.query(`DELETE FROM user_tags WHERE user_id = $1`, [perfilUsuarioId]);
            }

            // Eliminar préstamos relacionados antes de eliminar libros
            await db.query(`DELETE FROM loan_book WHERE user_id = $1`, [idUserReportado]);

            await db.query(`DELETE FROM loan_book WHERE id_propietario = $1`, [idUserReportado]);
            //await db.query(`DELETE FROM waiting_list WHERE id_propietario = $1`, [idUserReportado]);
            await db.query(`DELETE FROM waiting_list WHERE id_propietario = $1`, [idUserReportado]);
            // Eliminar datos relacionados en otras tablas
            await db.query(`DELETE FROM libro_tags USING libro WHERE libro_tags.libroid = libro.id_libro AND libro.idusuario = $1`, [idUserReportado]);
            await db.query(`DELETE FROM libro WHERE idusuario = $1`, [idUserReportado]);
            await db.query(`DELETE FROM perfil_usuario WHERE user_id = $1`, [idUserReportado]);
            await db.query(`DELETE FROM reportes WHERE id_usuario = $1`, [idUserReportado]);
            await db.query(`DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1`, [idUserReportado]);
            await db.query(`DELETE FROM waiting_list WHERE user_id = $1`, [idUserReportado]);

            // Eliminar el usuario
            await db.query(`DELETE FROM usuario WHERE id = $1`, [idUserReportado]);

            // Eliminar el reporte
            await db.query(`DELETE FROM reportes WHERE id_reporte = $1 AND id_usuario = $2`, [idReporte, idUserReportado]);

            await db.query('COMMIT');
            res.status(200).json({ message: "El usuario fue eliminado por exceder los strikes permitidos." });
        } else {
            // Actualizar strikes
            const addStrikeQuery = `UPDATE usuario SET strikes = $1 WHERE id = $2`;
            await db.query(addStrikeQuery, [updateStrikes, idUserReportado]);

            // Eliminar el reporte
            const deleteReportQuery = `DELETE FROM reportes WHERE id_reporte = $1 AND id_usuario = $2`;
            await db.query(deleteReportQuery, [idReporte, idUserReportado]);

            await db.query('COMMIT');
            res.status(200).json({ message: "El strike se agregó con éxito!" });
        }

    } catch (error) {
        await db.query('ROLLBACK');
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});



app.post('/api/ignoreStrikes', async (req, res)=>{
    const {idReporte, idUserReportado} = req.body;

    try {
        const deleteReportQuery = `DELETE FROM reportes WHERE id_reporte=$1 AND id_usuario=$2`;
        await db.query(deleteReportQuery, [idReporte, idUserReportado]);
        res.status(200).json({message:"El strike se omitio con exito!"})
        
    } catch (error) {
        res.status(500).json({error:"No se pudo omitir el reporte"})
    }
});

app.get('/api/WaitingList', verifyToken, async (req, res)=>{

    const idUser = req.user.userId;
    console.log("Usuario WL "+idUser);

    try {
        const waitingListQuery=`SELECT 
        waiting_list.request_date,
        waiting_list.waiting_id,
        waiting_list.turno,
        waiting_list.status,
        libro.coverimage,
        libro.titulo,
        libro.autor,
        libro.isbn,
        libro.id_libro,
        libro.descripcion,
        usuario.nombres AS owner_name,
        usuario.id AS owner_id
    FROM 
        waiting_list
    INNER JOIN 
        libro ON waiting_list.book_id = libro.id_libro
    INNER JOIN 
        usuario ON waiting_list.id_propietario = usuario.id
    WHERE waiting_list.user_id = $1`;

    const waitingListElementsReposne = await db.query(waitingListQuery, [idUser]);

    
    const elementsToSend = waitingListElementsReposne.rows;
    console.log(elementsToSend);
    res.status(200).json(elementsToSend);
        
    } catch (error) {
        res.status(500).json({error:"No se pudo obtener la lista de espera"})
    }
    
})
app.post('/api/cancelLoanRequest', verifyToken, async (req, res)=>{

    const userId = req.user.userId;
    console.log("userId: "+userId);

    const {ownerId, bookId}= req.body;
    console.log(ownerId +" "+bookId);

    try {
        const cancelWaitingListRequestQuery = `DELETE FROM waiting_list WHERE user_id =$1 AND book_id =$2 AND id_propietario =$3`;
        await db.query(cancelWaitingListRequestQuery, [userId, bookId, ownerId]);
        try {
            const updateTurnQuery = `UPDATE waiting_list
                                    SET turno = turno - 1
                                    WHERE book_id = $1 AND id_propietario = $2`;
            await db.query(updateTurnQuery, [bookId, ownerId]);

            
            res.status(200).json({message:"la solicitud de espera se elimino con exito :)"});
        } catch (error) {
            res.status(500).json({error:"No se pudo cancelar la solicitud de espera!"});
        }
    } catch (error) {
        res.status(500).json({error:"500: No se pudo eliminar la solicitud de la lista de espera"})
    }
})

app.get('/api/getRequests', verifyToken, async (req, res)=>{
    const userId = req.user.userId;
    console.log(userId);

    try {
        const getRequestsQuery = `SELECT 
                                loan_book.loan_date,
                                loan_book.loan_id,
                                loan_book.status,
                                loan_book.user_id,
                                loan_book.id_propietario,
                                libro.coverimage,
                                libro.titulo,
                                libro.autor,
                                libro.isbn,
                                libro.id_libro,
                                libro.descripcion,
                                usuario.nombres AS requester_name,
                                usuario.id AS requester_id
                            FROM 
                                loan_book
                            INNER JOIN 
                                libro ON loan_book.book_id = libro.id_libro
                            INNER JOIN 
                                usuario ON loan_book.user_id = usuario.id
                            WHERE loan_book.id_propietario = $1 AND loan_book.status =$2`;
        const requestResponse = await db.query(getRequestsQuery, [userId, 'waiting_confirmation']);
        const requestsToSend = requestResponse.rows;
        console.log(requestsToSend);
        res.status(200).json(requestsToSend);
        
    } catch (error) {
        res.status(500).json({error:"500: No se pudo obtener las solicitudes"})
    }
})


app.get('/api/history', verifyToken, async (req, res)=>{
    const userId = req.user.userId;

    console.log("usuario id "+userId);

    try {

        const getHistoryQuery =`SELECT 
        loan_book.loan_date,
        loan_book.loan_id,
        loan_book.status,
        loan_book.user_id,
        loan_book.id_propietario,
        libro.coverimage,
        libro.titulo,
        libro.autor,
        libro.isbn,
        libro.id_libro,
        libro.descripcion,
        usuario.nombres AS owner_name,
        usuario.id AS owner_id
        FROM 
            loan_book
        INNER JOIN 
            libro ON loan_book.book_id = libro.id_libro
        INNER JOIN 
            usuario ON loan_book.id_propietario = usuario.id
        WHERE loan_book.user_id = $1`;

        const getHistoryResponse = await db.query(getHistoryQuery,[userId]);

        const getHistory = getHistoryResponse.rows;
        console.log("Historial ");
        console.log(getHistory);
        res.status(200).json(getHistory);
        
    } catch (error) {
        res.status(500).json({error: "No se pudo obtener el historial"})
    }
});

app.post('/api/endLoan',verifyToken, async (req, res)=>{
    const userId = req.user.userId;
    console.log(userId);
    const {bookId, ownerId}=req.body;
    console.log(bookId +" "+ ownerId);

    try {
        const checkExistenceInWaitingListQuery = `SELECT FROM waiting_list WHERE id_propietario =$1 AND book_id =$2`;
        const checkExistenceInWaitingListResponse = await db.query(checkExistenceInWaitingListQuery, [ownerId, bookId]);

        console.log(checkExistenceInWaitingListResponse.rowCount);
        //checa que este en la lista de espera, si esta, se resta el turno y se inserta el menor a la tabla loan book, si no, se actualiza el estado

        if (checkExistenceInWaitingListResponse.rowCount===0) {
            console.log("No hay en la lista de espera");
            try {
                const deleteLoanQuery = `DELETE FROM loan_book WHERE id_propietario =$1 AND book_id =$2`;
                await db.query(deleteLoanQuery, [ownerId, bookId]);
                try {
                    const updateState = `UPDATE libro SET is_available = $1 WHERE id_libro =$2 AND idusuario =$3`;
                    await db.query(updateState, [true, bookId, ownerId]);
                    res.status(200).json({message:"Prestamo finalizado con exito"})
                } catch (error) {
                    res.status(500).json({error: "No se pudo actualizar el estado del libro"})
                }
            } catch (error) {
                
                res.status(500).json({error:"No se pudo borrar el prestamo"})
            }

        } else {
            try {
                const updateTurnQuery = `UPDATE waiting_list SET turno = turno -1 WHERE id_propietario =$1 AND book_id =$2`;
                await db.query(updateTurnQuery, [ownerId, bookId]);
                try {
                    const getNextBookToInsertQuery =`SELECT * FROM waiting_list WHERE turno =$1 AND id_propietario =$2 AND book_id =$3`;
                    const getNextBookToInsert = await db.query(getNextBookToInsertQuery, [0, ownerId, bookId]);
                    console.log("LISTAAAAA");
                    console.log(getNextBookToInsert.rows[0]);
                    const nextBookToInsert = getNextBookToInsert.rows[0];
                    const {waiting_id, user_id, book_id, request_date, status, id_propietario} =nextBookToInsert;
                    console.log(waiting_id + " "+user_id+" "+book_id+" "+request_date+" "+status+" "+id_propietario);

                    try {
                        const insertNewBookQuery = `INSERT INTO loan_book (user_id, book_id, loan_date, status, id_propietario) 
                                                    VALUES ($1,$2,$3,$4,$5)`;
                        await db.query(insertNewBookQuery, [user_id, book_id,request_date, status,id_propietario ]);
                        try {
                            const deleteWaitingListElementQuery = `DELETE FROM waiting_list WHERE id_propietario =$1 AND book_id =$2 AND user_id =$3 AND turno = $4`;
                            await db.query(deleteWaitingListElementQuery, [id_propietario,book_id,user_id,0]);
                            try {
                                const deleteLoanBookQuery = `DELETE FROM loan_book WHERE id_propietario=$1 AND book_id=$2 AND user_id=$3`;
                                await db.query(deleteLoanBookQuery, [id_propietario, book_id, userId]);
                                res.status(200).json({message:"Se finalizo el prestamo con exito"});
                            } catch (error) {
                                res.status(500).json({error:"No se pudo borrar el prestamo pasado"})
                            }
                        } catch (error) {
                            res.status(500).json({error:"No se pudo borrar el de la lista de espera"})
                        }
                    } catch (error) {
                        res.status(500).json({error:"No se pudo insertar el prestamo"})
                    }
                    
                } catch (error) {
                    res.status(500).json({error:"No se pudo obtener el turno 0"})
                }
            } catch (error) {
                res.status(500).json({error:"2"})
            }
            console.log("Hay existencia en la lista de espera");
        }
    } catch (error) {
        res.status(500).json({error:"No se pudo checar la lista de espera"})
    }
})

app.post('/api/rejectRequest', verifyToken, async (req, res)=>{
    const userId = req.user.userId;
    console.log(userId);
    const {requesterId, bookId} = req.body;
    console.log(requesterId+" "+bookId);
    

    try {
        const checkExistenceInWaitingListQuery = `SELECT FROM waiting_list WHERE id_propietario =$1 AND book_id =$2`;
        const checkExistenceInWaitingListResponse = await db.query(checkExistenceInWaitingListQuery, [userId, bookId]);
        ///console.log(checkExistenceInWaitingListResponse);
        console.log(checkExistenceInWaitingListResponse.rowCount);
        //checa que este en la lista de espera, si esta, se resta el turno y se inserta el menor a la tabla loan book, si no, se actualiza el estado

        if (checkExistenceInWaitingListResponse.rowCount===0) {
            console.log("No hay en la lista de espera");
            try {
                const deleteLoanQuery = `DELETE FROM loan_book WHERE id_propietario =$1 AND book_id =$2 AND user_id =$3`;
                await db.query(deleteLoanQuery, [userId, bookId, requesterId]);
                try {
                    const updateState = `UPDATE libro SET is_available = $1 WHERE id_libro =$2 AND idusuario =$3`;
                    await db.query(updateState, [true, bookId, userId]);
                    res.status(200).json({message:"Prestamo rechazado con exito"})
                } catch (error) {
                    res.status(500).json({error: "No se pudo actualizar el estado del libro"})
                }
            } catch (error) {
                
                res.status(500).json({error:"No se pudo rechazar el prestamo"})
            }

        }else{
            console.log("Si hay en la lista de espera");
            
            try {
                const updateTurnQuery = `UPDATE waiting_list SET turno = turno -1 WHERE id_propietario =$1 AND book_id =$2`;
                await db.query(updateTurnQuery, [userId, bookId]);
                try {
                    const getNextBookToInsertQuery =`SELECT * FROM waiting_list WHERE turno =$1 AND id_propietario =$2 AND book_id =$3`;
                    const getNextBookToInsert = await db.query(getNextBookToInsertQuery, [0, userId, bookId]);
                    console.log("LISTAAAAA");
                    console.log(getNextBookToInsert.rows[0]);
                    const nextBookToInsert = getNextBookToInsert.rows[0];
                    const {waiting_id, user_id, book_id, request_date, status, id_propietario} =nextBookToInsert;
                    console.log(waiting_id + " "+user_id+" "+book_id+" "+request_date+" "+status+" "+id_propietario);
                    try {
                        const insertNewBookQuery = `INSERT INTO loan_book (user_id, book_id, loan_date, status, id_propietario) 
                                                    VALUES ($1,$2,$3,$4,$5)`;
                        await db.query(insertNewBookQuery, [user_id, book_id,request_date, status,id_propietario ]);
                        try {
                            const deleteWaitingListElementQuery = `DELETE FROM waiting_list WHERE id_propietario =$1 AND book_id =$2 AND user_id =$3 AND turno = $4`;
                            await db.query(deleteWaitingListElementQuery, [userId,book_id,user_id,0]);
                            try {
                                const deleteLoanBookQuery = `DELETE FROM loan_book WHERE id_propietario=$1 AND book_id=$2 AND user_id=$3`;
                                await db.query(deleteLoanBookQuery, [userId, book_id, requesterId]);
                                res.status(200).json({message:"Se rechazo el prestamo con exito"});
                            } catch (error) {
                                res.status(500).json({error:"No se pudo borrar al usuario de loan"})
                            }
                        } catch (error) {
                            res.status(500).json({error:"Ya no se que poner"})
                        }
                        
                    } catch (error) {
                        res.status(500).json({error:"No se pudo insertar el nuevo libro"})
                    }
                    
                } catch (error) {
                    res.status(500).json({error:"No se pudo obetener un libro con turno cero"})
                }
                
            } catch (error) {
                res.status(500).json({error:"No se pudo reducir el turno"})
            }
        }
        
    } catch (error) {
        res.status
    }
})

app.post('/api/acceptRequest', verifyToken, async (req, res)=>{
    const userId =  req.user.userId;
    const {requesterId, bookId, loanId} = req.body;
    console.log("mi id: "+ userId);
    console.log("Libro: "+bookId+" El id del otro "+ requesterId+" Loan id: "+loanId);
    try {
        const updateStatus = `UPDATE loan_book SET status =$1 WHERE loan_id = $2 AND book_id=$3 AND id_propietario =$4`;
        await db.query(updateStatus, ['accepted', loanId, bookId, userId]);

        try {
            const insertChatQuery =`INSERT INTO messages (loan_id, sender_id, receiver_id, message_text)
                                    VALUES($1,$2,$3,$4)`;
            await db.query(insertChatQuery, [loanId, userId, requesterId, "tu prestamo ha sido aceptado!"]);
            res.status(200).json({message:"Prestamo aceptado"});
        } catch (error) {
            res.status(500).json({error:"No se pudo iniciar chat"});
        }
        
    } catch (error) {
        res.status(500).json({error:"No se pudo aceptar el prestamo"})
    }

    
})

app.get('/api/getChats', verifyToken, async (req, res)=>{
    const userId =  req.user.userId;
    console.log(userId);
    try {
        const getChatsQuery=`SELECT DISTINCT ON (lb.loan_id) 
                            lb.loan_id,
                            u1.id AS user1_id,
                            u1.nombres AS user1_nombres,
                            u1.apellidos AS user1_apellidos,
                            u2.id AS user2_id,
                            u2.nombres AS user2_nombres,
                            u2.apellidos AS user2_apellidos,
                            CASE 
                                WHEN m.sender_id != $1 THEN u2.id -- If authenticated user is receiver
                                WHEN m.sender_id = $1 THEN u1.id -- If authenticated user is sender
                            END AS other_user_id,
                            CASE 
                                WHEN m.sender_id != $1 THEN pu2.profile_pic -- If authenticated user is receiver
                                WHEN m.sender_id = $1 THEN pu1.profile_pic -- If authenticated user is sender
                            END AS other_user_profile_pic,
                            l.id_libro,
                            l.titulo AS libro_titulo,
                            l.autor AS libro_autor,
                            l.isbn AS libro_isbn,
                            l.descripcion AS libro_descripcion,
                            l.coverimage AS libro_coverimage,
                            l.is_available AS libro_is_available,
                            CASE 
                                WHEN m.sender_id != $1 THEN u2.nombres || ' ' || u2.apellidos -- If authenticated user is receiver
                                WHEN m.sender_id = $1 THEN u1.nombres || ' ' || u1.apellidos -- If authenticated user is sender
                            END AS other_user_name
                        FROM 
                            public.loan_book lb
                        JOIN 
                            public.usuario u1 ON lb.user_id = u1.id
                        JOIN 
                            public.usuario u2 ON lb.id_propietario = u2.id
                        JOIN 
                            public.libro l ON lb.book_id = l.id_libro
                        JOIN 
                            public.messages m ON lb.loan_id = m.loan_id
                        LEFT JOIN 
                            public.perfil_usuario pu1 ON u1.id = pu1.user_id -- Profile pic of the authenticated user
                        LEFT JOIN 
                            public.perfil_usuario pu2 ON u2.id = pu2.user_id -- Profile pic of the other user
                        WHERE 
                            m.sender_id = $1 OR m.receiver_id = $1
                        ORDER BY 
                            lb.loan_id, m.sent_at DESC`;
        const getChatsResponse = await db.query(getChatsQuery, [userId])

        console.log(getChatsResponse.rows);
        const chats = getChatsResponse.rows;
        res.status(200).json(chats)
        
    } catch (error) {
        res.status(500).json({error:"No se pudieron cargar los chats"})
    }
})

app.get('/api/getMyId', verifyToken, async(req, res)=>{
    try {
        const userId = req.user.userId;
        console.log("este es el id " +userId);
        res.status(200).json(userId);
    } catch (error) {
        res.status(500).json({error:"No se pudo decodificar el id"});
    }

})
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  
  
  // Your existing Express middleware and routes
  // ...
  
  // Socket.IO integration
  const server = http.createServer(app);
  const io = new SocketIOServer(server);
  
  const websocketServer = http.createServer();
  const websocketPort = 3001;
  
  const websocketIO = new SocketIOServer(websocketServer, {
      path: '/socket.io',
      cors: {
          origin: 'http://localhost:5173',
          methods: ["GET", "POST"]
      }
  });
  
  websocketIO.on('connection', (socket) => {
      console.log('WebSocket client connected');
      console.log('Client connected');
  
      socket.on('getMessages', async ({ userId, otherUserId, idChat }) => {
          console.log('Received getMessages event from client with data:', { userId, otherUserId, idChat });
  
          try {
              const messagesQuery = `
                  SELECT * FROM messages
                  WHERE loan_id = $1
                  ORDER BY sent_at ASC;`;
              const { rows: messages } = await db.query(messagesQuery, [idChat]);
            
              socket.emit('messages', messages);
          } catch (error) {
              console.error('Error retrieving messages from the database:', error);
              socket.emit('error', 'An error occurred while retrieving messages');
          }
      });
  
      socket.on('sendMessage', async ({ userId, otherUserId, idChat, text, timestamp }) => {
          console.log('Received sendMessage event from client with data:', { userId, otherUserId, idChat, text, timestamp });
  
          try {
              const newMessageQuery = `
                  INSERT INTO messages (sender_id, receiver_id, loan_id, message_text, sent_at)
                  VALUES ($1, $2, $3, $4, $5)
                  RETURNING *;
              `;
              const { rows: newMessages } = await db.query(newMessageQuery, [userId, otherUserId, idChat, text, timestamp]);
  
              const newMessage = newMessages[0];
              websocketIO.emit('newMessage', newMessage); // Broadcast the new message to all connected clients
          } catch (error) {
              console.error('Error saving new message to the database:', error);
              socket.emit('error', 'An error occurred while saving the new message');
          }
      });
  
      socket.on('disconnect', () => {
          console.log('WebSocket client disconnected');
      });
  });
  
  websocketServer.listen(websocketPort, () => {
      console.log(`WebSocket server listening on port ${websocketPort}`);
  });
  









  app.post('/api/calificaciones', async (req, res) => {
    const { toUserId, rating } = req.body; // Extrae los datos del cuerpo de la solicitud

    try {
        // Asegúrate de que los valores sean válidos
        if (!toUserId || !rating) {
            return res.status(400).json({ message: "Faltan parámetros" });
        }

        // Inserta la calificación en la base de datos
        const query = 'INSERT INTO calificaciones (to_user_id, rating) VALUES ($1, $2)';
        await db.query(query, [toUserId, rating]);

        res.status(200).json({ message: "Alerta Alerta Alerta ESTO LO DEBO DE CAMBIAR PERO ME DIO HUEVA" });
    } catch (error) {
        console.error("Error al enviar la calificación:", error);
        res.status(500).json({ message: "Error al enviar la calificación" });
    }
});





// Endpoint para obtener calificaciones de un usuario
app.get('/api/calificaciones/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        const result = await db.query('SELECT * FROM calificaciones WHERE to_user_id = $1', [userId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener las calificaciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});



app.post('/api/calificaciones_libros', async (req, res) => {
    const { id_libro, id_usuario, calificacion, comentario } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO calificaciones_libros (id_libro, id_usuario, calificacion, comentario) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [id_libro, id_usuario, calificacion, comentario]
        );
        res.json({ message: 'Calificación añadida con éxito', calificacion: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error al añadir calificación' });
    }
});


app.get('/api/calificaciones_libros/:id_libro', async (req, res) => {
    const { id_libro } = req.params;

    try {
        const result = await pool.query(
            `SELECT * FROM calificaciones_libros WHERE id_libro = $1`,
            [id_libro]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las calificaciones' });
    }
});














app.post('/api/calificar_libro', async (req, res) => {
    const { id_libro, rating, comentario } = req.body;

    // Verifica que los datos están llegando
    console.log('Datos recibidos:', { id_libro, rating, comentario });

    if (!id_libro || !rating) {
        return res.status(400).json({ message: 'ID del libro y calificación son obligatorios' });
    }

    try {
        // Guardar la calificación en la base de datos
        await pool.query(
            'INSERT INTO calificaciones_libros (id_libro, rating, comentario) VALUES ($1, $2, $3)',
            [id_libro, rating, comentario]
        );
      
        res.json({ message: 'Calificación enviada correctamente' });

    } catch (error) {
        console.error('Error al guardar la calificación:', error);
        res.status(500).json({ message: 'Error al enviar la calificación' });
    }
});




app.post('/api/comentarios_usuarios', async (req, res) => {
    const { id_usuario, id_usuario_comentado, comentario } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO comentarios_usuarios (id_usuario, id_usuario_comentado, comentario) 
             VALUES ($1, $2, $3) RETURNING *`,
            [id_usuario, id_usuario_comentado, comentario]
        );
        res.json({ message: 'Comentario añadido con éxito', comentario: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error al añadir comentario' });
    }
});






app.get('/api/comentarios_usuarios/:id_usuario_comentado', async (req, res) => {
    const { id_usuario_comentado } = req.params;

    try {
        const result = await pool.query(
            `SELECT * FROM comentarios_usuarios WHERE id_usuario_comentado = $1`,
            [id_usuario_comentado]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener los comentarios' });
    }
});






app.get('/api/calificaciones_usuarios/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // Consulta SQL para obtener el promedio de calificaciones del usuario
        const result = await pool.query(
            'SELECT AVG(rating) as promedio FROM calificaciones_usuarios WHERE id_usuario = $1',
            [userId]
        );

        if (result.rows.length > 0 && result.rows[0].promedio !== null) {
            res.json({ promedio: result.rows[0].promedio });
        } else {
            // Si no hay calificaciones para este usuario, devolvemos un promedio de 0
            res.json({ promedio: 0 });
        }
    } catch (error) {
        console.error('Error al obtener el promedio de calificaciones del usuario:', error);
        res.status(500).json({ error: 'Error al obtener el promedio de calificaciones del usuario' });
    }
});

app.post('/api/calificaciones', verifyToken, async (req, res) => {
    const { toUserId, rating } = req.body; // ID del usuario calificado y la calificación
    const fromUserId = req.user.userId; // ID del usuario que califica
    try {
        const insertRatingQuery = `
            INSERT INTO public.calificaciones_usuarios (from_user_id, to_user_id, rating)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await db.query(insertRatingQuery, [fromUserId, toUserId, rating]);
        res.status(201).json({ message: "Calificación creada exitosamente", data: result.rows[0] });
    } catch (error) {
        console.error('Error al crear la calificación:', error);
        res.status(500).json({ error: "No se pudo crear la calificación" });
    }
});

app.get('/api/calificaciones/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // Consulta para obtener las calificaciones
        const getRatingsQuery = `
            SELECT * FROM public.calificaciones_usuarios
            WHERE to_user_id = $1;
        `;
        const ratingsResult = await db.query(getRatingsQuery, [userId]);

        // Consulta para obtener el promedio de calificaciones
        const getAverageRatingQuery = `
            SELECT AVG(rating) AS promedio_calificacion
            FROM public.calificaciones_usuarios
            WHERE to_user_id = $1;
        `;
        const averageResult = await db.query(getAverageRatingQuery, [userId]);

        res.status(200).json({
            ratings: ratingsResult.rows,
            promedio: averageResult.rows[0].promedio_calificacion
        });
    } catch (error) {
        console.error('Error al obtener las calificaciones:', error);
        res.status(500).json({ error: "No se pudieron obtener las calificaciones" });
    }
});






// En tu backend (Node.js)
app.post('/api/calificaciones', async (req, res) => {
    const { username, rating } = req.body;

    // Aquí deberías verificar si el nombre de usuario existe
    const user = await User.findOne({ where: { username } }); // Usa tu ORM/consulta adecuada

    if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Lógica para almacenar la calificación
    // Por ejemplo:
    await Rating.create({ userId: user.id, rating }); // Asume que tienes un modelo Rating

    res.json({ message: 'Calificación enviada exitosamente' });
});


app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await db.query('SELECT id, nombres FROM public.usuario');
        res.status(200).json(result.rows); // Devuelve los usuarios con ID y nombre
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});








app.get('/api/calificaciones/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM calificaciones WHERE to_user_id = $1', [userId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener las calificaciones:', error);
        res.status(500).json({ message: 'Error al obtener las calificaciones' });
    }
});






app.post("/api/addComment", verifyToken, async (req, res) => {
    const { comentario, id_profile } = req.body;
    const id_user = req.user.userId; 
  
    try {
      
      const queryProfile = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
      const profileResult = await db.query(queryProfile, [id_profile]); 
  
      if (profileResult.rowCount === 0) {
        return res
          .status(404)
          .json({ error: "Perfil no encontrado para el user_id proporcionado" });
      }
  
      const actualIdProfile = profileResult.rows[0].id; 
  
      
      const query = `
        INSERT INTO comentarios (id_user, id_profile, comentario, fechuki)
        VALUES ($1, $2, $3, NOW()) RETURNING id_com`;
      const result = await db.query(query, [
        id_user,
        actualIdProfile,
        comentario,
      ]);
  
      res.status(200).json({
        message: "Comentario agregado exitosamente",
        id_com: result.rows[0].id_com,
      });
    } catch (error) {
      console.error("Error al agregar comentario:", error);
      res.status(500).json({ error: "No se pudo agregar el comentario" });
    }
  });
  
  app.get("/api/getComments/:profileId", async (req, res) => {
    const { profileId } = req.params; 
  
    try {
      
      const queryProfile = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
      const profileResult = await db.query(queryProfile, [profileId]);
  
      if (profileResult.rowCount === 0) {
        return res
          .status(404)
          .json({ message: "Perfil no encontrado para este usuario" });
      }
  
      const actualIdProfile = profileResult.rows[0].id; 
      
      const queryComments = `
        SELECT c.id_com, c.comentario, c.fechuki, u.nombres, u.apellidos, p.profile_pic
        FROM comentarios c
        INNER JOIN usuario u ON c.id_user = u.id
        LEFT JOIN perfil_usuario p ON u.id = p.user_id  -- Unimos con perfil_usuario para obtener la foto de perfil
        WHERE c.id_profile = $1
        ORDER BY c.fechuki DESC`;
      const commentsResult = await db.query(queryComments, [actualIdProfile]);
  
      if (commentsResult.rowCount === 0) {
        return res
          .status(404)
          .json({ message: "No se encontraron comentarios para este perfil" });
      }
  
      res.status(200).json(commentsResult.rows);
    } catch (error) {
      console.error("Error al obtener comentarios:", error);
      res.status(500).json({ error: "No se pudieron cargar los comentarios" });
    }
  });
  
  app.get("/api/getMyComments", verifyToken, async (req, res) => {
    const id_user = req.user.userId; 
  
    try {
      
      const queryProfile = `SELECT id FROM perfil_usuario WHERE user_id = $1`;
      const profileResult = await db.query(queryProfile, [id_user]);
  
      if (profileResult.rowCount === 0) {
        return res.status(404).json({ message: "Perfil no encontrado" });
      }
  
      const actualIdProfile = profileResult.rows[0].id;
  
      
      const queryComments = `
        SELECT c.id_com, c.comentario, c.fechuki, u.nombres, u.apellidos, p.profile_pic
        FROM comentarios c
        INNER JOIN usuario u ON c.id_user = u.id
        LEFT JOIN perfil_usuario p ON u.id = p.user_id
        WHERE c.id_profile = $1
        ORDER BY c.fechuki DESC`;
      const commentsResult = await db.query(queryComments, [actualIdProfile]);
  
      if (commentsResult.rowCount === 0) {
        return res.status(404).json({ message: "No se encontraron comentarios" });
      }
  
      res.status(200).json(commentsResult.rows);
    } catch (error) {
      console.error("Error al obtener comentarios:", error);
      res.status(500).json({ error: "No se pudieron cargar los comentarios" });
    }
  });







