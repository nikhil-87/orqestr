import { NotificationService } from "./notification.service";
import { Controller, ParamsController } from "../../utils/types";

type notifParams = {
  id: string;
};

export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  getUserNotifications: Controller = async (req, res, next) => {
    try {
      const result = await this.notificationService.getUserNotifications(req.userId!);
      res.status(200).json({
        message: "Notifications fetched successfully",
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  markAsRead: ParamsController<notifParams> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const updated = await this.notificationService.markAsRead(id, req.userId!);
      res.status(200).json({
        message: "Notification marked as read",
        success: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  };

  markAllAsRead: Controller = async (req, res, next) => {
    try {
      const result = await this.notificationService.markAllAsRead(req.userId!);
      res.status(200).json({
        message: "All notifications marked as read",
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  deleteNotification: ParamsController<notifParams> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const deleted = await this.notificationService.deleteNotification(id, req.userId!);
      res.status(200).json({
        message: "Notification deleted successfully",
        success: true,
        data: deleted,
      });
    } catch (err) {
      next(err);
    }
  };
}
