const Turn = require("../models/Turn.js");
const Servicio = require("../models/Service.js");
const Notification = require("../models/Notification.js");
const sequelize = require("../config/db.js");
const router = require("express").Router();
const { getSocketByUserId } = require("../config/socket.js");
const { Op } = require("sequelize");

//Obtener los turnos de un paseador
router.get("/turns/walker/:walker_id", async (req, res) => {
  const walkerId = req.params.walker_id;
  const turns = await Turn.findAll({
    where: {
      WalkerId: walkerId,
    },
    include: Servicio,
  });
  res.status(200).json({
    ok: true,
    status: 200,
    body: turns,
  });
});

//Obtener un turno por su id
router.get("/turns/:turn_id", async (req, res) => {
  const id = req.params.turn_id;
  const turn = await Turn.findOne({
    where: {
      id: id,
    },
  });
  res.status(200).json({
    ok: true,
    status: 200,
    body: turn,
  });
});

//Agregar un turno
router.post("/turns", async (req, res) => {
  try {
    const turnData = req.body;

    // Crea el turno dentro de la transacción
    const turn = await Turn.create({
      dias: turnData.dias,
      hora_inicio: turnData.hora_inicio,
      hora_fin: turnData.hora_fin,
      tarifa: turnData.tarifa,
      zona: turnData.zona,
      WalkerId: turnData.WalkerId, // Asigna el ID del Walker al turno
    });

    // Obtén el turno creado, incluyendo relaciones, dentro de la misma transacción
    const turnCreated = await Turn.findByPk(turn.dataValues.id, {
      include: Servicio,
    });

    res.status(201).json({
      ok: true,
      status: 201,
      message: "Turno creado exitosamente",
      data: turnCreated,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      status: 500,
      message: error.message,
    });
    console.error("Error al crear turno:", error);
  }
});

// Modificar un turno
router.put("/turns/:turn_id", async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const id = req.params.turn_id;
    const turnData = req.body;

    // Verificar si el turno existe
    const existingTurn = await Turn.findOne({ where: { id: id }, transaction });
    if (!existingTurn) {
      await transaction.rollback();
      return res.status(404).json({
        ok: false,
        status: 404,
        message: "Turno no encontrado",
      });
    }

    // Verificar servicios asociados al turno
    const turnServices = await Servicio.findAll({
      where: { TurnId: id, aceptado: true, finalizado: false },
      transaction,
    });
    if (turnServices.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        ok: false,
        status: 400,
        message: "Turno no puede ser modificado, ya tiene servicios asociados",
      });
    }

    // Verificar solicitudes de servicio asociadas al turno
    const turnRequests = await Servicio.findAll({
      where: { TurnId: id, aceptado: false },
      transaction,
    });

    // Si hay solicitudes pendientes, eliminarlas y notificar a los clientes
    if (turnRequests.length > 0) {
      await Servicio.destroy({
        where: { TurnId: id, aceptado: false },
        transaction,
      });
      // Obtener la fecha y hora actual
      const fechaHoraActual = new Date();

      // Restar 3 horas
      fechaHoraActual.setHours(fechaHoraActual.getHours() - 3);

      // Formatear la fecha a 'yyyy-MM-dd HH:mm'
      const formattedFechaHoraActual = fechaHoraActual
        .toISOString()
        .slice(0, 16) // 'yyyy-MM-ddTHH:mm'
        .replace("T", " "); // Cambia 'T' por un espacio

      for (const servicio of turnRequests) {
        const notification = await Notification.create(
          {
            titulo: "Servicio rechazado",
            contenido: `La solicitud de servicio para la fecha ${servicio.fecha} ha sido rechazada por cambios en el turno`,
            userId: servicio.ClientId,
            fechaHora: formattedFechaHoraActual,
          },
          { transaction }
        );

        const targetSocket = getSocketByUserId(servicio.ClientId);
        if (targetSocket) {
          targetSocket[1].emit("notification", notification.toJSON());
          targetSocket[1].emit("refreshServices");
        }
        const targetSocketWalker = getSocketByUserId(turnData.WalkerId);
        if (targetSocketWalker) {
          targetSocketWalker[1].emit("refreshServices");
        }
      }
    }

    // Actualiza el turno
    await Turn.update(
      {
        dias: turnData.dias,
        hora_inicio: turnData.hora_inicio,
        hora_fin: turnData.hora_fin,
        tarifa: turnData.tarifa,
        zona: turnData.zona,
        WalkerId: turnData.WalkerId,
      },
      { where: { id: id }, transaction }
    );

    // Obtener el turno actualizado con los datos relacionados
    const updatedTurn = await Turn.findOne({
      where: { id: id },
      include: Servicio,
      transaction,
    });

    await transaction.commit();

    res.status(200).json({
      ok: true,
      status: 200,
      body: updatedTurn,
      message: "Turno modificado exitosamente",
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ ok: false, message: "Error al modificar turno" });
    console.error("Error al modificar turno:", error);
  }
});

router.delete("/turns/:turn_id", async (req, res) => {
  try {
    await sequelize.transaction(async (t) => {
      const id = req.params.turn_id;

      // Obtener el turno
      const turn = await Turn.findByPk(id);
      if (!turn) {
        throw new Error("Turno no encontrado");
      }

      const walkerId = turn.WalkerId;

      // Obtener la fecha y hora actual
      const fechaActual = new Date();

      // Restar 3 horas
      fechaActual.setHours(fechaActual.getHours() - 3);

      // Formatear la fecha a 'yyyy-MM-dd HH:mm'
      const formattedFechaActual = fechaActual
        .toISOString()
        .slice(0, 10) // 'yyyy-MM-dd'

      // Verificar si hay servicios aceptados para hoy o el futuro
      const turnServices = await Servicio.findAll({ 
        where: { TurnId: id, aceptado: true, finalizado: false, fecha: { [Op.gte]: formattedFechaActual }},
        transaction: t,
      });

      

      if (turnServices.length > 0) {
        throw new Error(
          "Turno no puede ser eliminado, ya tiene servicios asociados"
        );
      }

      // Obtener solicitudes de servicio no aceptadas
      const servicios = await Servicio.findAll({
        where: {
          TurnId: id,
          aceptado: false,
        },
        transaction: t,
      });

      // Eliminar servicios no aceptados
      if (servicios.length > 0) {
        await Servicio.destroy({
          where: {
            TurnId: id,
            aceptado: false,
          },
          transaction: t,
        });
      }

      // Eliminar el turno
      const deleteTurn = await Turn.destroy({
        where: { id: id },
        transaction: t,
      });

      if (!deleteTurn) {
        throw new Error("No se encontró el turno");
      }

      // Notificaciones
      const fechaHoraActual = new Date();
      fechaHoraActual.setHours(fechaHoraActual.getHours() - 3);
      const formattedFechaHoraActual = fechaHoraActual
        .toISOString()
        .slice(0, 16)
        .replace("T", " ");

      for (const servicio of servicios) {
        const notification = await Notification.create(
          {
            titulo: "Servicio cancelado",
            contenido: `El servicio para la fecha ${servicio.fecha} ha sido cancelado`,
            userId: servicio.ClientId,
            fechaHora: formattedFechaHoraActual,
          },
          { transaction: t }
        );

        const clientSocket = getSocketByUserId(servicio.ClientId);
        if (clientSocket) {
          clientSocket[1].emit("notification", notification.toJSON());
          clientSocket[1].emit("refreshServices");
        }

        const walkerSocket = getSocketByUserId(walkerId);
        if (walkerSocket) {
          walkerSocket[1].emit("refreshServices");
        }
      }
    });

    // Si todo salió bien, responder con éxito
    return res.status(200).json({
      ok: true,
      status: 200,
      message: "Turno eliminado exitosamente",
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      status: 400,
      message: error.message,
    });
  }
});

module.exports = router;
