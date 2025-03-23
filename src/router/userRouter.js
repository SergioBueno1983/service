const Client = require("../models/Client");
const User = require("../models/User");
const Walker = require("../models/Walker");
const sequelize = require("../config/db.js");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const globalConstants = require("../const/globalConstants");
const authMiddleware = require("../middlewares/authMiddleware");

const defaultImagePath = path.resolve(__dirname, "../../images/no_image.png");
const ruta = path.resolve(__dirname, "..", "..", "images");

// Verifica si la carpeta existe, y si no, créala
if (!fs.existsSync(ruta)) {
  fs.mkdirSync(ruta, { recursive: true });
  console.log("Carpeta de imágenes creada en:", ruta);
} else {
  console.log("Carpeta de imágenes ya existe en:", ruta);
}
const images = multer({
  dest: "images/",
  fileFilter: (req, file, cb) => {
    const allowedExtensions = [".png", ".jpg", ".jpeg"];
    const fileExtension = path.extname(file.originalname).toLowerCase();
  
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error("Formato no permitido. Solo PNG, JPG y JPEG."));
    }
    cb(null, true);
  },  
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "images/");
    },
    filename: function (req, file, cb) {
      let finalName = "";

      if (req.params.nameImage) {
        finalName = req.params.nameImage + ".png";
      } else {
        const originalName = file.originalname;
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        //creo la variable fecha en formato yyyy-dd-MM hh:mm:ss
        const date = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

        if (extension !== ".png" && extension !== ".jpg") {
          // si la extension no es jpg ni png, la hago png
          finalName = baseName + date + ".png";
        } else {
          // si es jpg o png la guardo con esa extension
          finalName = baseName + date + extension;
        }

        let counter = 1;

        while (fs.existsSync(path.join("images", finalName))) {
          finalName = `${baseName}_${counter}${extension}`;
          counter++;
        }
      }

      cb(null, finalName);
    },
  }),
});

const router = require("express").Router();

//agregar o cambiar foto de perfil
router.post(
  "/image/single/:nameImage",
  authMiddleware,
  images.single("imagenPerfil"),
  async (req, res) => {
    const username = req.params.nameImage;

    try{

      const user = await User.findOne({ where: { nombre_usuario: username } });

      if (!user) {
        return res
          .status(404)
          .json({ ok: false, message: "Usuario no encontrado" });
      }
      
        res.status(200).json({
        ok: true,
        message: "Imagen de perfil actualizada exitosamente",
      });
    } catch (error) {
      console.error("Error al actualizar imagen de perfil:", error);
      res
        .status(500)
        .json({ ok: false, message: "Error al actualizar imagen de perfil" });
    }
  }
);

// subir fotos al perfil del paseador
router.post(
  "/image/walker/single/:walkerId",
  authMiddleware,
  images.single("imagenPaseador"),
  async (req, res) => {
    try {
      const walkerId = req.params.walkerId;

      const walker = await Walker.findOne({
        where: { id: walkerId },
        include: {
          model: User,
          paranoid: false,
        },
      });

      if (!walker) {
        return res
          .status(404)
          .json({ ok: false, message: "Paseador no encontrado" });
      }

      // Obtén la lista actual de fotos (se espera que sea un array de objetos con { url: string })
      const currentFotos = walker.fotos || [];

      // Extrae la extensión del archivo original usando path
      let extension = path.extname(req.file.originalname).toLowerCase();
      const allowedExtensions = [".png", ".jpg", ".jpeg"];
      if (!allowedExtensions.includes(extension)) {
        // Si no es jpg, jpeg o png, se asigna .png por defecto
        extension = ".png";
      }

      // Se busca el contador máximo de las fotos existentes con formato "p<walkerId>_<numero>"
      let maxCounter = 0;
      const regex = new RegExp(`^p${walkerId}_(\\d+)`);
      currentFotos.forEach((foto) => {
        const match = foto.url.match(regex);
        if (match && match[1]) {
          const counter = parseInt(match[1], 10);
          if (counter > maxCounter) {
            maxCounter = counter;
          }
        }
      });
      const newCounter = maxCounter + 1;
	
      const newFileName = `p${walkerId}_${newCounter}${extension}`;

      // Define la ruta de destino donde se guardarán las imágenes
      const destinationDir = path.join(__dirname, "..", "..", "images");
      const destinationPath = path.join(destinationDir, newFileName);

      // Asegúrate de que el directorio destino exista
      if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true });
      }

      // Renombra y mueve el archivo de la ubicación temporal a la carpeta destino
      fs.renameSync(req.file.path, destinationPath);

      // Actualiza la lista de fotos del paseador (se almacena solo el nombre, aunque podrías formar la URL completa)
      const updatedFotos = [...currentFotos, { url: newFileName }];
      await walker.update({ fotos: updatedFotos });

      res.status(200).json({
        ok: true,
        message: "Foto subida con éxito",
        newImage: { url: newFileName },
      });
    } catch (error) {
      console.error("Error al actualizar imagen de perfil:", error);
      res
        .status(500)
        .json({ ok: false, message: "Error al actualizar imagen de perfil" });
    }
  }
);

//solicitud de imagen
router.get("/image/single/:nameImage", authMiddleware, async (req, res) => {
  const username = req.params.nameImage;

  try {
    // Busca el usuario en la base de datos por su nombre de usuario
    const user = await User.findOne({ where: { nombre_usuario: username } });

    if (!user) {
      // Si no se encuentra el usuario devuelve un error 404
      return res.status(404).send("Usuario no encontrado");
    }

    if (!user.foto) {
      return res.sendFile(defaultImagePath);
    }

    // Construye la ruta completa de la imagen en el servidor
    const imagePath = path.join(ruta, user.foto);
    console.log(imagePath);

    // Envía la imagen como respuesta
    res.sendFile(imagePath);
  } catch (error) {
    console.error("Error al obtener la imagen del usuario:", error);
    res.status(500).send("Error interno del servidor");
  }
});

router.get("/image/walkers/:imageName", authMiddleware, async (req, res) => {
  const imageName = req.params.imageName;
  try {
    // Construye la ruta completa de la imagen en el servidor
    const imagePath = path.join(ruta, imageName);

    // Envía la imagen como respuesta
    res.sendFile(imagePath);
  } catch (error) {
    console.error("Error al obtener las imágenes de los paseadores:", error);
    res.status(500).send("Error interno del servidor");
  }
});

router.get("/image/walkers", authMiddleware, async (req, res) => {
  try {
    const walkers = await Walker.findAll({
      include: {
        model: User,
        paranoid: false,
        attributes: ["nombre_usuario", "foto"],
      },
    });

    const walkerImages = walkers.map((walker) => ({
      nombre_usuario: walker.User.nombre_usuario,
      foto: walker.User.foto
        ? `${globalConstants.EXTERNAL_URI}/images/${walker.User.foto}`
        : null,
    }));

    res.status(200).json(walkerImages);
  } catch (error) {
    console.error("Error al obtener las imágenes de los paseadores:", error);
    res.status(500).send("Error interno del servidor");
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    // Busca el usuario por su nombre de usuario en la base de datos
    const user = await User.findOne({
      where: {
        nombre_usuario: username,
      },
    });

    var contraseniaCoincide = false;
    if (user)
      contraseniaCoincide = bcrypt.compareSync(password, user.contraseña);

    // Si no se encuentra el usuario o la contraseña no coincide, responde con un error de autenticación
    if (!user || !contraseniaCoincide) {
      return res
        .status(401)
        .json({ ok: false, message: "Usuario y/o contraseña incorrecta" });
    }

    const client = await Client.findByPk(user.id);
    // Si no encontro el cliente, significa que es paseador
    var logedUser;
    if (client === null) {
      // Agrega un atributo 'tipo' al objeto del usuario
      logedUser = user.toJSON(); // Convertimos el modelo Sequelize a un objeto JSON
      logedUser.tipo = "walker";
    } else {
      logedUser = user.toJSON();
      logedUser.tipo = "client";
    }

    // Si el usuario y la contraseña son correctos, devuelves el usuario encontrado
    res.status(200).json({
      ok: true,
      logedUser,
      token: jwt.sign({ userId: user.id }, process.env.JWT_SECRET),
    });
  } catch (error) {
    console.error("Error de autenticación:", error);
    res.status(500).json({ ok: false, message: "Error de autenticación" });
  }
});

// Modificar datos básicos del usuario (incluyendo la contraseña)
router.put("/users/password/:user_id", authMiddleware, async (req, res) => {
  try {
    const userData = req.body;
    const id = req.params.user_id; // Corregido el parámetro
    const newContraseña = userData.newContraseña
      ? bcrypt.hashSync(userData.newContraseña, 10)
      : null; // Solo generar hash si hay nueva contraseña
    const contraseña = userData.contraseña;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        ok: false,
        status: 404,
        message: "Usuario no encontrado",
      });
    }

    // Comparar contraseña actual
    const isMatch = await bcrypt.compare(contraseña, user.contraseña);
    if (!isMatch) {
      return res.status(400).json({
        ok: false,
        status: 400,
        message: "La contraseña actual no es correcta",
      });
    }

    // Modificar el usuario
    await User.update(
      {
        contraseña: newContraseña,
        direccion: userData.direccion,
        email: userData.email,
        telefono: userData.telefono,
      },
      {
        where: {
          id: id,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      status: 200,
      message: "Usuario modificado exitosamente",
    });
  } catch (error) {
    console.error("Error al modificar usuario:", error);
    return res.status(500).json({
      ok: false,
      status: 500,
      message: error.message || "Error al modificar usuario",
      error: error.message || "Error inesperado",
    });
  }
});

// Modificar datos básicos del usuario (sin cambiar contraseña)
router.put("/users/:user_id", authMiddleware, async (req, res) => {
  try {
    const userData = req.body;
    const id = req.params.user_id; // Corregido el parámetro

    // Modificar el usuario
    await User.update(
      {
        direccion: userData.direccion,
        email: userData.email,
        telefono: userData.telefono,
      },
      {
        where: {
          id: id,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      status: 200,
      message: "Usuario modificado exitosamente",
    });
  } catch (error) {
    console.error("Error al modificar usuario:", error);
    return res.status(500).json({
      ok: false,
      status: 500,
      message: error.message || "Error al modificar usuario",
      error: error.message || "Error inesperado",
    });
  }
});


module.exports = router;
